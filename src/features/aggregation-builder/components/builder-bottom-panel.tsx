import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import type { QueryResult } from "@/shared/api";
import type { AggregationStage } from "@/shared/store";
import { QueryResultsGrid } from "@/shared/components/data-grid/query-results-grid";
import { BsonEditor } from "@/shared/components/query-editor/bson-json-editor";
import { PlanView, type PlanCall } from "@/shared/components/plan-view";
import { cn } from "@/shared/lib/utils";
import { docsText } from "../lib/format";
import { PREVIEW_SHOW, type CardPreview } from "../lib/use-previews";
import type { PipelineRun } from "../lib/use-pipeline-run";

export type PanelTab = "stage" | "run" | "plan";
export type PanelView = "grid" | "json";

/** The JSON view of a big run shows this many documents; the grid shows all. */
const JSON_VIEW_MAX = 500;

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="bg-muted rounded-control flex items-center p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-inset text-small focus-visible:ring-ring/50 h-6 px-2 outline-none focus-visible:ring-2",
            value === o.value
              ? "bg-background text-foreground font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Under the canvas: the selected card's output or the full Run result,
 *  each as the console's grid or as documents, or the pipeline's plan. */
export function BuilderBottomPanel({
  conn_id,
  tab_key,
  database,
  tab,
  onTab,
  view,
  onView,
  stage,
  label,
  preview,
  run,
  onStop,
  plan,
  onStopPlan,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  view: PanelView;
  onView: (v: PanelView) => void;
  stage: AggregationStage | null;
  /** The selected card's name, such as "Stage 3". */
  label: string;
  preview: CardPreview | undefined;
  run: PipelineRun | null;
  onStop?: () => void;
  plan: PlanCall | null;
  onStopPlan: () => void;
}) {
  return (
    <section
      aria-label="Pipeline output"
      className="bg-background flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <div className="bg-editor-toolbar flex shrink-0 items-center gap-2 border-b px-3 py-1">
        <Segmented
          label="Output"
          value={tab}
          onChange={onTab}
          options={[
            { value: "stage", label: "Stage output" },
            { value: "run", label: "Run result" },
            { value: "plan", label: "Plan" },
          ]}
        />
        <span className="text-muted-foreground text-small min-w-0 truncate">
          {tab === "stage"
            ? stage
              ? `${label}, ${stage.op}: up to ${PREVIEW_SHOW} documents of its preview`
              : "Select a stage to see its documents"
            : tab === "run"
              ? run
                ? runSummary(run)
                : "Run the pipeline to see its full result"
              : plan?.mode === "analyze"
                ? "The plan, with what the run really did"
                : "The plan the server estimates, without running it"}
        </span>
        <div className={cn("ml-auto", tab === "plan" && "hidden")}>
          <Segmented
            label="View"
            value={view}
            onChange={onView}
            options={[
              { value: "grid", label: "Grid" },
              { value: "json", label: "JSON" },
            ]}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === "stage" ? (
          <StageOutput
            conn_id={conn_id}
            tab_key={tab_key}
            database={database}
            view={view}
            stage={stage}
            preview={preview}
          />
        ) : tab === "plan" ? (
          plan ? (
            <PlanView tab={plan} on_stop={onStopPlan} />
          ) : (
            <Message>
              Explain shows how the server runs the whole pipeline.
            </Message>
          )
        ) : (
          <RunOutput
            conn_id={conn_id}
            tab_key={tab_key}
            database={database}
            view={view}
            run={run}
            onStop={onStop}
          />
        )}
      </div>
    </section>
  );
}

function runSummary(run: PipelineRun): string {
  if (run.running) return run.stopping ? "Stopping…" : "Running…";
  const n = run.snapshot?.row_count ?? 0;
  const docs = `${n.toLocaleString()} ${n === 1 ? "document" : "documents"}`;
  if (run.cancelled) return `Stopped after ${docs}`;
  if (run.error) return "The run failed";
  return run.elapsed_ms !== null ? `${docs} in ${run.elapsed_ms} ms` : docs;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-body flex h-full items-center justify-center p-6 text-center">
      {children}
    </p>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 text-destructive text-body flex shrink-0 items-start gap-2 border-b px-3 py-2 whitespace-pre-wrap"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {message}
    </div>
  );
}

function JsonDocs({ docs, total }: { docs: unknown[]; total: number }) {
  const shown = Math.min(docs.length, JSON_VIEW_MAX);
  // The run's documents array only grows, so its length is part of the key.
  const text = useMemo(() => docsText(docs.slice(0, shown)), [docs, shown]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {total > shown && (
        <p className="text-muted-foreground text-small shrink-0 border-b px-3 py-1">
          Showing the first {shown.toLocaleString()} of {total.toLocaleString()}{" "}
          documents. The grid shows them all.
        </p>
      )}
      <BsonEditor
        value={text}
        onChange={() => {}}
        readOnly
        foldable
        minHeight="0"
        className="min-h-0 flex-1 rounded-none border-0"
      />
    </div>
  );
}

function StageOutput({
  conn_id,
  tab_key,
  database,
  view,
  stage,
  preview,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
  view: PanelView;
  stage: AggregationStage | null;
  preview: CardPreview | undefined;
}) {
  const chunk = preview?.chunk;
  if (!stage)
    return (
      <Message>
        Select a stage on the canvas to see up to {PREVIEW_SHOW} of the
        documents it puts out.
      </Message>
    );
  if (!chunk)
    return (
      <Message>
        {preview?.status === "running"
          ? "Previewing…"
          : "This stage has no preview yet."}
      </Message>
    );
  if (chunk.error) return <ErrorBanner message={chunk.error} />;
  if (chunk.documents.length === 0)
    return <Message>No documents come out of this stage.</Message>;
  if (view === "json")
    return <JsonDocs docs={chunk.documents} total={chunk.documents.length} />;
  const result: QueryResult = {
    columns: chunk.columns,
    rows: chunk.rows,
    rows_affected: 0,
    is_select: true,
    error: null,
    elapsed_ms: chunk.elapsed_ms,
  };
  return (
    <QueryResultsGrid
      result={result}
      conn_id={conn_id}
      tab_key={`${tab_key}:stage`}
      query_text={`${stage.op}: ${stage.body}`}
      query_language="js"
      database={database}
    />
  );
}

function RunOutput({
  conn_id,
  tab_key,
  database,
  view,
  run,
  onStop,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
  view: PanelView;
  run: PipelineRun | null;
  onStop?: () => void;
}) {
  if (!run)
    return (
      <Message>
        Run streams the whole pipeline, with no cap, into this view.
      </Message>
    );
  const snap = run.snapshot;
  const docs = snap?.documents ?? [];
  const result: QueryResult = {
    columns: snap?.columns ?? [],
    rows: snap?.rows ?? [],
    row_count: snap?.row_count ?? 0,
    rows_affected: 0,
    is_select: true,
    error: null,
    elapsed_ms: run.elapsed_ms ?? 0,
    cancelled: run.cancelled,
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {run.error && <ErrorBanner message={run.error} />}
      <div className="min-h-0 flex-1">
        {view === "json" && !run.running ? (
          docs.length > 0 ? (
            <JsonDocs docs={docs} total={snap?.row_count ?? docs.length} />
          ) : (
            <Message>No documents.</Message>
          )
        ) : (
          (snap || run.running) && (
            <QueryResultsGrid
              result={result}
              conn_id={conn_id}
              tab_key={`${tab_key}:run`}
              query_text={run.command}
              query_language="js"
              database={database}
              loading={
                run.running
                  ? {
                      started_at: run.started_at,
                      on_stop: onStop,
                      stopping: run.stopping,
                    }
                  : undefined
              }
            />
          )
        )}
      </div>
    </div>
  );
}
