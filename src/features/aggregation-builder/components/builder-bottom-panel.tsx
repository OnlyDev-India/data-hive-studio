import { useMemo } from "react";
import {
  BottomPanel,
  PanelError,
  PanelMessage,
  PREVIEW_SHOW,
  PreviewGrid,
  RunGrid,
  runSummary,
  Segmented,
} from "@/shared/components/builder-canvas";
import type { AggregationStage } from "@/shared/store";
import { BsonEditor } from "@/shared/components/query-editor/bson-json-editor";
import { PlanView, type PlanCall } from "@/shared/components/plan-view";
import { cn } from "@/shared/lib/utils";
import { docsText } from "../lib/format";
import type { CardPreview } from "../lib/use-previews";
import type { PipelineRun } from "../lib/use-pipeline-run";

export type PanelTab = "stage" | "run" | "plan";
export type PanelView = "grid" | "json";

/** The JSON view of a big run shows this many documents; the grid shows all. */
const JSON_VIEW_MAX = 500;
const DOCS: [string, string] = ["document", "documents"];

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
    <BottomPanel
      label="Pipeline output"
      tab={tab}
      onTab={onTab}
      tabs={[
        { value: "stage", label: "Stage output" },
        { value: "run", label: "Run result" },
        { value: "plan", label: "Plan" },
      ]}
      summary={
        tab === "stage"
          ? stage
            ? `${label}, ${stage.op}: up to ${PREVIEW_SHOW} documents of its preview`
            : "Select a stage to see its documents"
          : tab === "run"
            ? run
              ? runSummary(run, DOCS)
              : "Run the pipeline to see its full result"
            : plan?.mode === "analyze"
              ? "The plan, with what the run really did"
              : "The plan the server estimates, without running it"
      }
      aside={
        <div className={cn(tab === "plan" && "hidden")}>
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
      }
    >
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
          <PanelMessage>
            Explain shows how the server runs the whole pipeline.
          </PanelMessage>
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
    </BottomPanel>
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
      <PanelMessage>
        Select a stage on the canvas to see up to {PREVIEW_SHOW} of the
        documents it puts out.
      </PanelMessage>
    );
  if (!chunk)
    return (
      <PanelMessage>
        {preview?.status === "running"
          ? "Previewing…"
          : "This stage has no preview yet."}
      </PanelMessage>
    );
  if (chunk.error) return <PanelError message={chunk.error} />;
  if (chunk.documents.length === 0)
    return <PanelMessage>No documents come out of this stage.</PanelMessage>;
  if (view === "json")
    return <JsonDocs docs={chunk.documents} total={chunk.documents.length} />;
  return (
    <PreviewGrid
      columns={chunk.columns}
      rows={chunk.rows}
      elapsed_ms={chunk.elapsed_ms}
      conn_id={conn_id}
      grid_key={`${tab_key}:stage`}
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
      <PanelMessage>
        Run streams the whole pipeline, with no cap, into this view.
      </PanelMessage>
    );
  const snap = run.snapshot;
  const docs = snap?.documents ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {run.error && <PanelError message={run.error} />}
      <div className="min-h-0 flex-1">
        {view === "json" && !run.running ? (
          docs.length > 0 ? (
            <JsonDocs docs={docs} total={snap?.row_count ?? docs.length} />
          ) : (
            <PanelMessage>No documents.</PanelMessage>
          )
        ) : (
          <RunGrid
            run={run}
            onStop={onStop}
            conn_id={conn_id}
            grid_key={`${tab_key}:run`}
            query_text={run.command}
            query_language="js"
            database={database}
          />
        )}
      </div>
    </div>
  );
}
