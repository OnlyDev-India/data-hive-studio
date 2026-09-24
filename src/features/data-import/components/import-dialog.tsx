import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import {
  IMPORT_CANCELLABLE,
  cancelRun,
  importCapabilities,
  importRows,
  listTables,
  tableSchema,
  type ColumnInfo,
  type ImportOnError,
  type ImportProgress,
} from "@/shared/api";
import { useWriteConfirm } from "@/shared/hooks/use-write-confirm";
import { useStudioStore, type ImportTarget } from "@/shared/store";
import {
  asTarget,
  buildCreateSql,
  newTableProblem,
  proposeColumns,
  suggestTableName,
  type NewColumn,
} from "../lib/build-create-sql";
import { saveFailedCsv } from "../lib/failed-csv";
import { formatBytes } from "../lib/limits";
import { autoMap, unmappedRequired, type Mapping } from "../lib/mapping";
import { parseFile } from "../lib/parse-file";
import {
  makeContext,
  mergeReport,
  prepare,
  type Outcome,
} from "../lib/prepare";
import type { ParseOptions, ParsedFile } from "../lib/types";
import { isDocumentDb } from "../lib/typed-cell";
import { FileOptions } from "./file-options";
import { NewTableForm } from "./new-table-form";
import { MappingTable } from "./mapping-table";
import { PreviewTable } from "./preview-table";
import { ResultView } from "./result-view";

type Step = "choose" | "map" | "importing" | "result";

const DEFAULT_OPTS: ParseOptions = { encoding: "utf-8", hasHeader: true };

/** The import dialog (spec 0008), mounted once in `Studio` and opened with
 *  `openImport`. */
export function ImportDialog() {
  const target = useStudioStore((s) => s.importTarget);
  // Mounted only while open, so every open starts from the file picker.
  return target ? <ImportBody target={target} /> : null;
}

function ImportBody({ target }: { target: ImportTarget }) {
  const close = useStudioStore((s) => s.closeImport);
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const db = useStudioStore(
    (s) => s.open.find((c) => c.id === target.connId)?.kind,
  );
  const readOnly = useStudioStore(
    (s) => !!s.open.find((c) => c.id === target.connId)?.read_only,
  );
  // Only a warning: bridges do not carry a connection id, so a same named
  // table on another connection can trigger it too.
  const stagedEdits = useStudioStore((s) =>
    Object.values(s.gridBridges).some(
      (b) => b?.pending_exists && b.table === target.table,
    ),
  );
  const writeConfirm = useWriteConfirm(target.connId);

  const documents = isDocumentDb(db);
  const noun = documents ? "collection" : "table";
  // Whether a rollback undoes an import here. Null until Mongo answers.
  const [atomic, setAtomic] = useState<boolean | null>(documents ? null : true);
  const [step, setStep] = useState<Step>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<ParseOptions>(DEFAULT_OPTS);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [existingColumns, setExistingColumns] = useState<ColumnInfo[]>([]);
  const [existingMapping, setExistingMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newName, setNewName] = useState("");
  const [newCols, setNewCols] = useState<NewColumn[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [emptyAsText, setEmptyAsText] = useState(false);
  const [onError, setOnError] = useState<ImportOnError>("rollback");
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const runId = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    tableSchema(target.connId, target.table, target.database, target.schema)
      .then((s) => live && setExistingColumns(s.columns))
      .catch((e: unknown) => live && setError(errorText(e)));
    // Names already taken, for the new table check. Only the connection's own
    // schema is listed, so a table in another schema is caught by the database.
    if (!target.schema) {
      listTables(target.connId)
        .then((t) => live && setTables(t.map((x) => x.name)))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [target]);

  useEffect(() => {
    if (!documents) return;
    let live = true;
    importCapabilities(target.connId, target.database)
      .then((c) => live && setAtomic(c.atomic))
      // Not knowing is treated as "no transactions": warn, and no Check.
      .catch(() => live && setAtomic(false));
    return () => {
      live = false;
    };
  }, [documents, target.connId, target.database]);

  const isNew = mode === "new";
  const newTarget = useMemo(() => asTarget(newCols, db), [newCols, db]);
  const columns = isNew ? newTarget.columns : existingColumns;
  const mapping = isNew ? newTarget.mapping : existingMapping;
  const problem = isNew ? newTableProblem(newName, newCols, tables, db) : null;
  const blocked = isNew ? [] : unmappedRequired(columns, mapping);
  const mappedCount = Object.values(mapping).filter((v) => v !== null).length;

  async function load(f: File, o: ParseOptions) {
    setError(null);
    try {
      const p = await parseFile(f, o);
      setFile(f);
      setOpts(o);
      setParsed(p);
      setExistingMapping(autoMap(p.header, existingColumns));
      setNewCols(proposeColumns(p));
      if (!newName) setNewName(suggestTableName(f.name));
      setStep("map");
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function run(dryRun: boolean) {
    if (!parsed || !file) return;
    setError(null);
    // A Check writes nothing that stays, so only a real import asks first.
    if (
      !dryRun &&
      !(await writeConfirm.confirm_write(
        `Import ${parsed.rows.length.toLocaleString()} rows into ${isNew ? newName.trim() : target.table}`,
        "These rows will be written to the database.",
      ))
    ) {
      return;
    }
    setProgress(null);
    setCancelling(false);
    // Only the desktop can stop a run, so only it gets an id to stop.
    runId.current = IMPORT_CANCELLABLE ? crypto.randomUUID() : null;
    setStep("importing");
    try {
      const ctx = makeContext(parsed, mapping, columns, db, emptyAsText, isNew);
      const prep = prepare({
        table: isNew ? newName.trim() : target.table,
        createSql: isNew
          ? buildCreateSql(newName.trim(), newCols, db)
          : undefined,
        parsed,
        ctx,
        onError,
        dryRun,
        checkable: atomic !== false,
        sourceLabel: file.name,
      });
      const report = prep.request
        ? await importRows(
            target.connId,
            { ...prep.request, run_id: runId.current },
            target.database,
            target.schema,
            setProgress,
          )
        : null;
      const merged = mergeReport(prep, parsed, report);
      setOutcome(merged);
      setStep("result");
      if (merged.committed) {
        if (isNew) setTables((t) => [...t, newName.trim()]);
        target.onImported?.();
        pushNotification({
          kind: "success",
          title: isNew
            ? `Created ${newName.trim()} with ${merged.inserted.toLocaleString()} ${documents ? "documents" : "rows"}`
            : `Imported ${merged.inserted.toLocaleString()} rows into ${target.table}`,
        });
      }
    } catch (e) {
      setError(errorText(e));
      setStep("map");
    }
  }

  async function cancel() {
    if (!runId.current) return;
    setCancelling(true);
    try {
      await cancelRun(target.connId, runId.current);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function saveFailed() {
    if (!parsed || !outcome || !file) return;
    setSaving(true);
    try {
      await saveFailedCsv(
        parsed,
        outcome.failures,
        file.name.replace(/\.[^.]+$/, ""),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const busy = step === "importing";
  const rowCount = parsed?.rows.length.toLocaleString();
  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !busy && close()}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {isNew
                ? `Import into a new ${noun}`
                : `Import into ${target.table}`}
            </DialogTitle>
            <DialogDescription>
              {step === "choose" &&
                "Pick a CSV, JSON, JSON Lines or Excel (.xlsx) file."}
              {step === "map" &&
                `${file?.name} (${formatBytes(file?.size ?? 0)}), ${rowCount} rows. Match each column, or leave it blank to use its default.`}
              {step === "importing" &&
                "Working. Nothing is saved until the whole import is done."}
              {step === "result" && "Done."}
            </DialogDescription>
          </DialogHeader>

          {step === "choose" && (
            <button
              type="button"
              className="hover:bg-muted/50 flex h-32 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) void load(f, opts);
              }}
            >
              <FileUp className="size-5" />
              Choose a file, or drop one here
            </button>
          )}
          <input
            ref={input}
            type="file"
            accept=".csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f, opts);
              e.target.value = "";
            }}
          />

          {step === "map" && parsed && file && (
            <div className="space-y-3">
              <FileOptions
                parsed={parsed}
                opts={opts}
                onOpts={(o) => void load(file, o)}
                emptyAsText={emptyAsText}
                onEmptyAsText={setEmptyAsText}
                onError={onError}
                onOnError={setOnError}
                documents={documents}
              />
              {documents && atomic === false && onError === "rollback" && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  This server has no transactions, so Roll back is not atomic.
                  If a document fails, the ones before it stay in the
                  collection. The result tells you how many landed.
                </p>
              )}
              <div className="flex gap-4 text-sm">
                {(["existing", "new"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    {m === "existing"
                      ? `Into ${target.table}`
                      : `Into a new ${noun}`}
                  </label>
                ))}
              </div>
              {isNew ? (
                <NewTableForm
                  name={newName}
                  onName={setNewName}
                  columns={newCols}
                  onColumns={setNewCols}
                  db={db}
                />
              ) : (
                <MappingTable
                  columns={columns}
                  parsed={parsed}
                  mapping={mapping}
                  onMapping={setExistingMapping}
                />
              )}
              <PreviewTable
                parsed={parsed}
                mapping={mapping}
                columns={columns}
                db={db}
                emptyAsText={emptyAsText}
                newCollection={isNew}
              />
            </div>
          )}

          {step === "importing" && (
            <div className="flex h-24 flex-col items-center justify-center gap-2 text-sm">
              {IMPORT_CANCELLABLE && progress && progress.total > 0 ? (
                <>
                  <progress
                    className="h-2 w-64"
                    value={progress.done}
                    max={progress.total}
                  />
                  <span>
                    {cancelling
                      ? "Cancelling…"
                      : `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} rows`}
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {cancelling ? "Cancelling…" : "Working…"}
                </span>
              )}
            </div>
          )}

          {step === "result" && outcome && (
            <ResultView
              outcome={outcome}
              onSaveFailed={() => void saveFailed()}
              saving={saving}
            />
          )}

          {step === "map" && stagedEdits && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              The open {noun} has edits that are not applied. Apply or discard
              them first, or the grid will reload without them after the import.
            </p>
          )}
          {step === "map" && readOnly && (
            <p className="text-destructive text-sm">
              Read only connection: import is refused. Turn off read only in the
              connection settings.
            </p>
          )}
          {step === "map" && problem && (
            <p className="text-destructive text-sm">{problem}</p>
          )}
          {step === "map" && blocked.length > 0 && (
            <p className="text-destructive text-sm">
              Match {blocked.map((c) => `"${c}"`).join(", ")} before importing.
              The table needs a value there.
            </p>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter>
            {step === "result" ? (
              <>
                <Button variant="outline" onClick={() => setStep("map")}>
                  Back
                </Button>
                <Button onClick={close}>Close</Button>
              </>
            ) : (
              <>
                {busy && IMPORT_CANCELLABLE ? (
                  <Button
                    variant="outline"
                    disabled={cancelling}
                    onClick={() => void cancel()}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={close}>
                    Cancel
                  </Button>
                )}
                {step === "map" && (
                  <>
                    <Button
                      variant="outline"
                      title={
                        documents && atomic !== true
                          ? "Check needs a replica set or sharded cluster. A standalone server has no transactions, so a check would really write."
                          : undefined
                      }
                      disabled={
                        readOnly ||
                        blocked.length > 0 ||
                        mappedCount === 0 ||
                        problem !== null ||
                        (documents && atomic !== true)
                      }
                      onClick={() => void run(true)}
                    >
                      Check
                    </Button>
                    <Button
                      disabled={
                        readOnly ||
                        blocked.length > 0 ||
                        mappedCount === 0 ||
                        problem !== null
                      }
                      onClick={() => void run(false)}
                    >
                      Import {rowCount} rows
                    </Button>
                  </>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {writeConfirm.dialog}
    </>
  );
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
