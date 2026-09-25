import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileUp,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
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
import { ImportStepper, type StepName } from "./import-stepper";
import { MappingStep } from "./mapping-step";
import { OptionsStep } from "./options-step";
import { ResultView } from "./result-view";
import { ReviewStep } from "./review-step";
import { SourceStep } from "./source-step";

const STEP_ORDER: StepName[] = [
  "Source",
  "Options",
  "Mapping",
  "Review",
  "Run",
];

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
      (b) => !!target.table && b?.pending_exists && b.table === target.table,
    ),
  );
  const writeConfirm = useWriteConfirm(target.connId);

  // No table = opened from the activity bar, so the only choice is a new one.
  const existingTable = target.table;
  const documents = isDocumentDb(db);
  const noun = documents ? "collection" : "table";
  // Whether a rollback undoes an import here. Null until Mongo answers.
  const [atomic, setAtomic] = useState<boolean | null>(documents ? null : true);
  const [step, setStep] = useState<StepName>("Source");
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<ParseOptions>(DEFAULT_OPTS);
  // Edited on the Options step, and only read into the preview on Reload.
  const [draft, setDraft] = useState<ParseOptions>(DEFAULT_OPTS);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [existingColumns, setExistingColumns] = useState<ColumnInfo[]>([]);
  const [existingMapping, setExistingMapping] = useState<Mapping>({});
  const [mode, setMode] = useState<"existing" | "new">(
    target.table ? "existing" : "new",
  );
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
  const connName = useStudioStore(
    (s) => s.open.find((c) => c.id === target.connId)?.name,
  );

  useEffect(() => {
    let live = true;
    if (target.table) {
      tableSchema(target.connId, target.table, target.database, target.schema)
        .then((s) => live && setExistingColumns(s.columns))
        .catch((e: unknown) => live && setError(errorText(e)));
    }
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
      setDraft(o);
      setParsed(p);
      setExistingMapping(autoMap(p.header, existingColumns));
      setNewCols(proposeColumns(p));
      if (!newName) setNewName(suggestTableName(f.name));
      // A reload stays on Options; a fresh file moves on to it.
      setStep("Options");
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
        `Import ${parsed.rows.length.toLocaleString()} rows into ${isNew ? newName.trim() : existingTable}`,
        "These rows will be written to the database.",
      ))
    ) {
      return;
    }
    setProgress(null);
    setCancelling(false);
    // Only the desktop can stop a run, so only it gets an id to stop.
    runId.current = IMPORT_CANCELLABLE ? crypto.randomUUID() : null;
    setOutcome(null);
    setStep("Run");
    try {
      const ctx = makeContext(parsed, mapping, columns, db, emptyAsText, isNew);
      const prep = prepare({
        table: isNew ? newName.trim() : (existingTable ?? ""),
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
      if (merged.committed) {
        if (isNew) setTables((t) => [...t, newName.trim()]);
        target.onImported?.();
        pushNotification({
          kind: "success",
          title: isNew
            ? `Created ${newName.trim()} with ${merged.inserted.toLocaleString()} ${documents ? "documents" : "rows"}`
            : `Imported ${merged.inserted.toLocaleString()} rows into ${existingTable}`,
        });
      }
    } catch (e) {
      setError(errorText(e));
      setStep("Review");
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

  const running = step === "Run" && outcome === null;
  const rowCount = parsed?.rows.length ?? 0;
  const targetLabel = [
    connName,
    target.database,
    target.schema,
    isNew ? newName.trim() || `(new ${noun})` : existingTable,
  ]
    .filter(Boolean)
    .join(" / ");
  const cannotImport =
    readOnly || blocked.length > 0 || mappedCount === 0 || problem !== null;
  const stale =
    !!parsed &&
    (draft.encoding !== opts.encoding ||
      draft.hasHeader !== opts.hasHeader ||
      draft.sheet !== opts.sheet);

  // Whatever stops the person from going on, shown where they can fix it.
  const warnings: { text: string; bad: boolean }[] = [];
  if (step === "Mapping" || step === "Review") {
    if (stagedEdits)
      warnings.push({
        bad: false,
        text: `The open ${noun} has edits that are not applied. Apply or discard them first, or the grid will reload without them after the import.`,
      });
    if (readOnly)
      warnings.push({
        bad: true,
        text: "Read only connection: import is refused. Turn off read only in the connection settings.",
      });
    if (problem) warnings.push({ bad: true, text: problem });
    if (blocked.length > 0)
      warnings.push({
        bad: true,
        text: `Required target columns are not mapped: ${blocked.join(", ")}`,
      });
    else if (mappedCount === 0)
      warnings.push({ bad: true, text: "Map at least one column." });
  }

  const back = () =>
    setStep(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(step) - 1)]);
  const next = () =>
    setStep(STEP_ORDER[Math.min(4, STEP_ORDER.indexOf(step) + 1)]);

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && !running && close()}>
        {/* One `minmax(0, 1fr)` column so a wide preview scrolls inside its own
            box instead of stretching the grid (and the dialog) sideways. */}
        <DialogContent
          hideCloseButton={running}
          className="grid-cols-[minmax(0,1fr)] sm:max-w-5xl"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="size-5" />
              Import {noun === "table" ? "Table" : "Collection"} Data
            </DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-3">
            <div className="bg-accent/40 flex min-w-0 flex-1 items-baseline gap-3 rounded-lg border px-3 py-2.5">
              <span className="text-muted-foreground text-sm">
                Target {noun}
              </span>
              <span className="truncate font-medium" title={targetLabel}>
                {targetLabel}
              </span>
            </div>
            <Button
              variant="outline"
              disabled={running}
              onClick={() => input.current?.click()}
            >
              <Upload className="size-4" />
              {file ? "Change File" : "Choose File"}
            </Button>
          </div>
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

          <ImportStepper current={step} />

          {step === "Source" && (
            <SourceStep
              onPick={() => input.current?.click()}
              onDrop={(f) => void load(f, opts)}
            />
          )}

          {step === "Options" && parsed && file && (
            <OptionsStep
              fileName={file.name}
              parsed={parsed}
              draft={draft}
              onDraft={setDraft}
              stale={stale}
              onReload={() => void load(file, draft)}
              isNew={isNew}
              onMode={setMode}
              existingTable={existingTable}
              noun={noun}
              name={newName}
              onName={setNewName}
              emptyAsText={emptyAsText}
              onEmptyAsText={setEmptyAsText}
              documents={documents}
            />
          )}

          {step === "Mapping" && parsed && file && (
            <MappingStep
              fileName={file.name}
              parsed={parsed}
              columns={columns}
              mapping={mapping}
              onMapping={setExistingMapping}
              mappedCount={mappedCount}
              db={db}
              emptyAsText={emptyAsText}
              isNew={isNew}
              newCols={newCols}
              onNewCols={setNewCols}
            />
          )}

          {step === "Review" && parsed && file && (
            <ReviewStep
              targetLabel={targetLabel}
              fileName={file.name}
              rowCount={rowCount}
              mappedCount={mappedCount}
              columnCount={parsed.header.length}
              onError={onError}
              onOnError={setOnError}
              looseRollback={documents && atomic === false}
            />
          )}

          {step === "Run" && running && (
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

          {step === "Run" && outcome && (
            <ResultView
              outcome={outcome}
              onSaveFailed={() => void saveFailed()}
              saving={saving}
            />
          )}

          {warnings.map((w) => (
            <p
              key={w.text}
              className={`rounded-lg border px-3 py-2 text-sm ${
                w.bad
                  ? "border-destructive/50 text-destructive"
                  : "border-amber-500/50 text-amber-600 dark:text-amber-400"
              }`}
            >
              {w.text}
            </p>
          ))}
          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter>
            {step === "Run" && outcome ? (
              <>
                <Button variant="outline" onClick={() => setStep("Review")}>
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button onClick={close}>Close</Button>
              </>
            ) : (
              <>
                {running && IMPORT_CANCELLABLE ? (
                  <Button
                    variant="outline"
                    disabled={cancelling}
                    onClick={() => void cancel()}
                  >
                    <X className="size-4" />
                    Cancel
                  </Button>
                ) : (
                  <Button variant="outline" disabled={running} onClick={close}>
                    <X className="size-4" />
                    Cancel
                  </Button>
                )}
                {step !== "Source" && !running && (
                  <Button variant="outline" onClick={back}>
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                )}
                {step === "Options" && (
                  <Button disabled={stale} onClick={next}>
                    <ArrowRight className="size-4" />
                    Next
                  </Button>
                )}
                {step === "Mapping" && (
                  <Button disabled={cannotImport} onClick={next}>
                    <ArrowRight className="size-4" />
                    Next
                  </Button>
                )}
                {step === "Review" && (
                  <>
                    <Button
                      variant="outline"
                      title={
                        documents && atomic !== true
                          ? "Check needs a replica set or sharded cluster. A standalone server has no transactions, so a check would really write."
                          : undefined
                      }
                      disabled={cannotImport || (documents && atomic !== true)}
                      onClick={() => void run(true)}
                    >
                      Check
                    </Button>
                    <Button
                      disabled={cannotImport}
                      onClick={() => void run(false)}
                    >
                      <Upload className="size-4" />
                      Start Import
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
