import type {
  ColumnInfo,
  DbKind,
  ImportCell,
  ImportOnError,
  ImportReport,
  ImportRequest,
} from "@/shared/api";
import type { Mapping } from "./mapping";
import type { ParsedFile } from "./types";
import { isDocumentDb, typedCell } from "./typed-cell";
import { checkCell, columnKind, type ColumnKind } from "./validate-cell";

/** Failures kept for the list and the failed rows file, like the database layer. */
const MAX_KEPT = 10_000;

/** One row that will not load, pointing at the file row a person can find. */
export interface Failure {
  /** Index into `ParsedFile.rows`. */
  rowIndex: number;
  /** The row number in the file (counting the header). */
  sourceRow: number;
  column?: string | null;
  message: string;
}

interface Target {
  name: string;
  /** Index of the file column that feeds it. */
  from: number;
  kind: ColumnKind;
  /** The column's declared type, for typing a new collection's fields. */
  dataType: string;
}

export interface ConvertContext {
  targets: Target[];
  width: number;
  db: DbKind | undefined;
  /** CSV and Excel: an empty cell is NULL, or "" in a text column when this is on. */
  emptyRule: boolean;
  emptyAsText: boolean;
  /** A document store: an empty cell leaves the field out (AC-6). */
  documents: boolean;
  /** A new collection: cells go as typed JSON, not strings (AC-19). */
  typed: boolean;
}

export function makeContext(
  parsed: ParsedFile,
  mapping: Mapping,
  columns: ColumnInfo[],
  db: DbKind | undefined,
  emptyAsText: boolean,
  newCollection = false,
): ConvertContext {
  const targets: Target[] = [];
  for (const c of columns) {
    const from = mapping[c.name];
    if (from != null) {
      targets.push({
        name: c.name,
        from,
        kind: columnKind(c),
        dataType: c.data_type,
      });
    }
  }
  return {
    targets,
    width: parsed.header.length,
    db,
    emptyRule: parsed.format === "csv" || parsed.format === "xlsx",
    emptyAsText,
    documents: isDocumentDb(db),
    typed: isDocumentDb(db) && newCollection,
  };
}

export interface ConvertedRow {
  cells: ImportCell[];
  /** Per target: why that cell fails its type check, or null. */
  problems: (string | null)[];
  /** Per target: an empty cell in a document store, so the field is left out. */
  omit: boolean[];
  /** Set when the whole row is bad (more cells than the header). */
  rowProblem: string | null;
}

/** Apply the empty cell rule, pad a short row, and check and convert each mapped
 *  cell. A row longer than the header is a bad row (AC-7). */
export function convertRow(
  row: ImportCell[],
  ctx: ConvertContext,
): ConvertedRow {
  const problems: (string | null)[] = [];
  const omit: boolean[] = [];
  const cells = ctx.targets.map((t) => {
    // Only a short CSV row has nothing at `from`. A JSON null is a real null.
    let cell: ImportCell = row[t.from] === undefined ? "" : row[t.from];
    omit.push(false);
    if (ctx.emptyRule) {
      const empty =
        cell === "" || (t.kind !== "text" && String(cell).trim() === "");
      if (empty) {
        problems.push(null);
        const asText = ctx.emptyAsText && t.kind === "text";
        omit[omit.length - 1] = ctx.documents && !asText;
        return asText ? "" : null;
      }
    }
    if (cell === null) {
      problems.push(null);
      return null;
    }
    const checked = checkCell(cell, t.kind, ctx.db);
    let ok = checked.ok;
    let message = checked.ok ? null : checked.message;
    if (checked.ok) cell = checked.value;
    if (ok && ctx.typed) {
      const typed = typedCell(cell, t.dataType);
      if (typed.ok) cell = typed.value;
      else {
        ok = false;
        message = typed.message;
      }
    }
    problems.push(ok ? null : message);
    return cell;
  });
  const rowProblem =
    row.length > ctx.width
      ? `Has ${row.length} cells but the header has ${ctx.width}`
      : null;
  return { cells, problems, omit, rowProblem };
}

export interface Prepared {
  /** Null when no row is fit to send. */
  request: ImportRequest | null;
  /** For each row sent, its index in `ParsedFile.rows`. */
  sent: number[];
  failures: Failure[];
  failedTotal: number;
  onError: ImportOnError;
}

export interface PrepareInput {
  table: string;
  parsed: ParsedFile;
  ctx: ConvertContext;
  onError: ImportOnError;
  dryRun: boolean;
  sourceLabel: string;
  /** False when the connection cannot run a Check (a standalone Mongo). Then a
   *  Roll back import with a failed row sends nothing, since it could only be
   *  sent as a Check. */
  checkable?: boolean;
  /** The `CREATE TABLE` to run first inside the same transaction. */
  createSql?: string;
}

/** Convert every row and split it into rows to send and rows that already
 *  failed. A bad row is never sent (spec 0008 invariant). In Roll back mode a
 *  client failure means nothing can commit, so the rest still goes as a Check
 *  to find the database's own failures in the same pass. */
export function prepare(input: PrepareInput): Prepared {
  const { parsed, ctx } = input;
  const rows: ImportCell[][] = [];
  const docs: Record<string, unknown>[] = [];
  const sent: number[] = [];
  const failures: Failure[] = [];
  let failedTotal = 0;
  const fail = (rowIndex: number, column: string | null, message: string) => {
    failedTotal += 1;
    if (failures.length < MAX_KEPT) {
      failures.push({
        rowIndex,
        sourceRow: parsed.sourceRows[rowIndex],
        column,
        message,
      });
    }
  };
  parsed.rows.forEach((row, i) => {
    const r = convertRow(row, ctx);
    if (r.rowProblem) return fail(i, null, r.rowProblem);
    const bad = r.problems.findIndex((p) => p !== null);
    if (bad !== -1) return fail(i, ctx.targets[bad].name, r.problems[bad]!);
    if (ctx.documents) {
      const doc: Record<string, unknown> = {};
      r.cells.forEach((c, k) => {
        if (!r.omit[k]) doc[ctx.targets[k].name] = c;
      });
      docs.push(doc);
    } else {
      rows.push(r.cells);
    }
    sent.push(i);
  });
  const needsCheck = input.onError === "rollback" && failedTotal > 0;
  const nothing =
    sent.length === 0 || (needsCheck && input.checkable === false);
  const request: ImportRequest | null = nothing
    ? null
    : {
        table: input.table,
        create_sql: input.createSql ?? null,
        data: ctx.documents
          ? { kind: "docs", docs }
          : { kind: "rows", columns: ctx.targets.map((t) => t.name), rows },
        on_error: input.onError,
        dry_run: input.dryRun || needsCheck,
        source_label: input.sourceLabel,
      };
  return { request, sent, failures, failedTotal, onError: input.onError };
}

/** What the result view shows: the database's answer joined with the rows that
 *  failed before sending. */
export interface Outcome {
  inserted: number;
  committed: boolean;
  dryRun: boolean;
  cancelled: boolean;
  atomic: boolean;
  onError: ImportOnError;
  failures: Failure[];
  failedTotal: number;
  truncated: boolean;
}

/** Join the report to file rows through `sent`, so a database failure at
 *  position 12 of the rows sent points at the right row of the file. */
export function mergeReport(
  prep: Prepared,
  parsed: ParsedFile,
  report: ImportReport | null,
): Outcome {
  const failures = [...prep.failures];
  for (const f of report?.failed ?? []) {
    const rowIndex = prep.sent[f.index];
    if (rowIndex === undefined) continue;
    failures.push({
      rowIndex,
      sourceRow: parsed.sourceRows[rowIndex],
      column: f.column,
      message: f.message,
    });
  }
  failures.sort((a, b) => a.rowIndex - b.rowIndex);
  return {
    inserted: report?.inserted ?? 0,
    committed: report?.committed ?? false,
    dryRun: report?.dry_run ?? prep.request?.dry_run ?? false,
    cancelled: report?.cancelled ?? false,
    atomic: report?.atomic ?? true,
    onError: prep.onError,
    failures: failures.slice(0, MAX_KEPT),
    failedTotal: prep.failedTotal + (report?.failed_total ?? 0),
    truncated: report?.failed_truncated ?? false,
  };
}
