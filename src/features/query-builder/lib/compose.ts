import { parse as parseSql } from "sql-parser-cst";
import type { Clause } from "@/shared/store";
import { CLAUSE_LABEL, isEmpty, orderErrors, SKIPPABLE } from "./model";
import {
  isDistinct,
  joinText,
  parseJoin,
  parseLimit,
  parseTableRef,
  quoteIdent,
  refName,
  tableText,
  type Dialect,
  type TableRef,
} from "./sql-text";

/** How many rows a card's preview brings back for the bottom panel. */
export const PREVIEW_SHOW = 20;
/** The column every preview target adds for its count; Rust strips it. */
export const COUNT_COLUMN = "__dh_count";

export interface PreviewTarget {
  clause_id: string;
  sql: string;
  /** The LIMIT card's count is the window count after its offset and
   *  limit; other cards show the count as it comes. */
  limit?: { limit: number; offset: number };
}

export interface Composed {
  /** The whole query for Run, bare table names; null while any card fails. */
  sql: string | null;
  /** The same for Copy and Open in SQL editor: on Postgres every bare table
   *  is schema qualified. Unformatted. */
  output: string | null;
  /** One per card that is not skipped, up to the first failing card. */
  targets: PreviewTarget[];
  /** Counts the FROM table up to `cap + 1`. */
  probe: string | null;
  /** The FROM table as written, for the activity entry. */
  table: string | null;
  /** A card's own error: its text, its place, or a parse error in it. */
  errors: Map<string, string>;
  /** Empty optional cards, left out. */
  skipped: Set<string>;
}

interface Built {
  text: string;
  /** Each card's character range in `text`. */
  ranges: { id: string; from: number; to: number }[];
}

/** Text built piece by piece, remembering where each card's part sits. */
class Builder {
  text = "";
  ranges: Built["ranges"] = [];
  add(piece: string, id?: string) {
    const from = this.text.length;
    this.text += piece;
    if (id) this.ranges.push({ id, from, to: this.text.length });
  }
  done(): Built {
    return { text: this.text, ranges: this.ranges };
  }
}

interface Parts {
  from: { clause: Clause; table: TableRef };
  joins: { clause: Clause; text: string }[];
  where: Clause | null;
  group: Clause | null;
  having: Clause | null;
  select: Clause | null;
  order: Clause | null;
  limit: { clause: Clause; limit: number; offset: number } | null;
}

/** The select list a card's query uses: the SELECT card's, else the group
 *  keys and aggregates, else every column. */
function selectList(p: Parts): { text: string; id?: string } {
  if (p.select) return { text: p.select.body.trim(), id: p.select.id };
  if (p.group) {
    const items = [p.group.body.trim(), p.group.aggregates?.trim() ?? ""]
      .filter(Boolean)
      .join(", ");
    return { text: items, id: p.group.id };
  }
  return { text: "*" };
}

/** Build one query from parts. `fromText` is the FROM source; `count` adds
 *  the window count; `limit` overrides the LIMIT part. */
function build(
  p: Parts,
  fromText: string,
  opts: { count: boolean; limit: string | null },
): Built {
  const b = new Builder();
  const list = selectList(p);
  b.add("SELECT ");
  b.add(list.text, list.id);
  if (opts.count) b.add(`, COUNT(*) OVER () AS ${COUNT_COLUMN}`);
  b.add(" FROM ");
  b.add(fromText, p.from.clause.id);
  for (const j of p.joins) {
    b.add(" ");
    b.add(j.text, j.clause.id);
  }
  if (p.where) {
    b.add(" WHERE ");
    b.add(p.where.body.trim(), p.where.id);
  }
  if (p.group?.body.trim()) {
    b.add(" GROUP BY ");
    b.add(p.group.body.trim(), p.group.id);
  }
  if (p.having) {
    b.add(" HAVING ");
    b.add(p.having.body.trim(), p.having.id);
  }
  if (p.order) {
    b.add(" ORDER BY ");
    b.add(p.order.body.trim(), p.order.id);
  }
  if (opts.limit !== null) {
    b.add(" LIMIT ");
    b.add(opts.limit, p.limit?.clause.id);
  }
  return b.done();
}

/** The parser's first line, and which card its position falls in (else
 *  `fallback`, the last card in the query). */
function parseError(
  built: Built,
  dialect: Dialect,
  fallback: string,
): { id: string; message: string } | null {
  try {
    parseSql(built.text, { dialect, includeRange: true });
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const offset = errorOffset(built.text, message);
    const hit =
      offset === null
        ? undefined
        : (built.ranges.find((r) => offset >= r.from && offset < r.to) ??
          built.ranges.find((r) => offset === r.to));
    return { id: hit?.id ?? fallback, message: message.split("\n")[0] };
  }
}

/** The offset a `sql-parser-cst` message points at ("--> undefined:1:17"). */
function errorOffset(text: string, message: string): number | null {
  const m = /-->\s*\S*?:(\d+):(\d+)/.exec(message);
  if (!m) return null;
  const line = Number(m[1]);
  const column = Number(m[2]);
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++)
    offset += lines[i].length + 1;
  return offset + column - 1;
}

/** Qualify a bare table with `schema` (Postgres output). */
function qualified(t: TableRef, schema: string | null, dialect: Dialect) {
  if (t.schema || !schema || dialect !== "postgresql") return t;
  return { ...t, schema: quoteIdent(schema, dialect) };
}

/** Compose the cards into the query, each card's preview query, and the
 *  probe. Pure: no connection. */
export function compose({
  clauses,
  dialect,
  schema,
  cap,
}: {
  clauses: Clause[];
  dialect: Dialect;
  /** The tab's default schema (Postgres), for the qualified output. */
  schema: string | null;
  cap: number;
}): Composed {
  const errors = orderErrors(clauses);
  const skipped = new Set<string>();
  const out: Composed = {
    sql: null,
    output: null,
    targets: [],
    probe: null,
    table: null,
    errors,
    skipped,
  };

  // Read each card's text; the first card that fails stops the walk.
  const readable: Clause[] = [];
  let from: Parts["from"] | null = null;
  for (const c of clauses) {
    if (errors.has(c.id)) break;
    if (isEmpty(c)) {
      if (SKIPPABLE.has(c.kind)) {
        skipped.add(c.id);
        continue;
      }
      errors.set(
        c.id,
        c.kind === "from"
          ? "Pick a table to start from"
          : c.kind === "join"
            ? "Pick a table to join"
            : `${CLAUSE_LABEL[c.kind]} needs a key column or an aggregate`,
      );
      break;
    }
    if (c.kind === "from") {
      const table = parseTableRef(c.body);
      if (!table) {
        errors.set(c.id, "FROM takes one table, with an optional alias");
        break;
      }
      from = { clause: c, table };
    }
    if (c.kind === "join" && !parseJoin(c.body)) {
      errors.set(
        c.id,
        "JOIN takes the join type, one table with an optional alias, and ON or USING",
      );
      break;
    }
    if (c.kind === "limit" && !parseLimit(c.body)) {
      errors.set(c.id, "LIMIT takes a row count and an optional OFFSET");
      break;
    }
    readable.push(c);
  }
  if (!from) return out;
  out.table = tableText({ ...from.table, alias: null });
  out.probe = `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${out.table} LIMIT ${cap + 1}) AS p`;

  const parts: Parts = {
    from,
    joins: [],
    where: null,
    group: null,
    having: null,
    select: null,
    order: null,
    limit: null,
  };
  const capped = `(SELECT * FROM ${out.table} LIMIT ${cap}) AS ${refName(from.table)}`;

  for (const c of readable) {
    if (c.kind === "join") parts.joins.push({ clause: c, text: c.body.trim() });
    else if (c.kind === "limit") {
      const l = parseLimit(c.body)!;
      parts.limit = { clause: c, ...l };
    } else if (c.kind !== "from") parts[c.kind] = c;

    const distinct = !!parts.select && isDistinct(parts.select.body);
    let built: Built;
    let target: PreviewTarget;
    if (distinct) {
      const inner = build(parts, capped, {
        count: false,
        limit: parts.limit ? limitText(parts.limit) : null,
      });
      const b = new Builder();
      b.add(`SELECT q.*, COUNT(*) OVER () AS ${COUNT_COLUMN} FROM (`);
      const shift = b.text.length;
      b.add(inner.text);
      b.add(`) AS q LIMIT ${PREVIEW_SHOW}`);
      built = {
        text: b.text,
        ranges: inner.ranges.map((r) => ({
          ...r,
          from: r.from + shift,
          to: r.to + shift,
        })),
      };
      target = { clause_id: c.id, sql: built.text };
    } else {
      const shown = parts.limit
        ? `${Math.min(parts.limit.limit, PREVIEW_SHOW)}${parts.limit.offset ? ` OFFSET ${parts.limit.offset}` : ""}`
        : String(PREVIEW_SHOW);
      built = build(parts, capped, { count: true, limit: shown });
      target = {
        clause_id: c.id,
        sql: built.text,
        ...(parts.limit && c.kind === "limit"
          ? { limit: { limit: parts.limit.limit, offset: parts.limit.offset } }
          : {}),
      };
    }
    const bad = parseError(built, dialect, c.id);
    if (bad) {
      errors.set(bad.id, bad.message);
      // A parse error in an earlier card's text drops that card's target.
      const at = out.targets.findIndex((t) => t.clause_id === bad.id);
      if (at >= 0) out.targets = out.targets.slice(0, at);
      break;
    }
    out.targets.push(target);
  }

  if (errors.size > 0) return out;
  const plain = build(parts, tableText(from.table), {
    count: false,
    limit: parts.limit ? limitText(parts.limit) : null,
  });
  out.sql = plain.text;
  const q = (t: TableRef) => qualified(t, schema, dialect);
  out.output = build(
    {
      ...parts,
      joins: parts.joins.map((j) => {
        const jp = parseJoin(j.text)!;
        return { ...j, text: joinText({ ...jp, table: q(jp.table) }) };
      }),
    },
    tableText(q(from.table)),
    { count: false, limit: parts.limit ? limitText(parts.limit) : null },
  ).text;
  return out;
}

function limitText(l: { limit: number; offset: number }) {
  return l.offset ? `${l.limit} OFFSET ${l.offset}` : String(l.limit);
}

/** The count a card shows: the LIMIT card's is cut by its offset and limit. */
export function shownCount(count: number, target?: PreviewTarget): number {
  if (!target?.limit) return count;
  const { limit, offset } = target.limit;
  return Math.min(Math.max(count - offset, 0), limit);
}

/** Every table the cards read, as the catalog names them. */
export function queryTables(clauses: Clause[]): TableRef[] {
  const out: TableRef[] = [];
  for (const c of clauses) {
    const t =
      c.kind === "from"
        ? parseTableRef(c.body)
        : c.kind === "join"
          ? (parseJoin(c.body)?.table ?? null)
          : null;
    if (t) out.push(t);
  }
  return out;
}
