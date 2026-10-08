import {
  BottomPanel,
  PanelError,
  PanelMessage,
  PreviewGrid,
  RunGrid,
  runSummary,
  type BuilderRun,
} from "@/shared/components/builder-canvas";
import type { Clause } from "@/shared/store";
import { PREVIEW_SHOW } from "../lib/compose";
import { CLAUSE_LABEL } from "../lib/model";
import type { ClausePreview } from "../lib/use-sql-previews";

export type OutputTab = "card" | "run";

const ROWS: [string, string] = ["row", "rows"];

/** Under the canvas: the selected card's preview rows, or the full Run
 *  result. */
export function OutputPanel({
  conn_id,
  tab_key,
  database,
  tab,
  onTab,
  clause,
  ordinal,
  preview,
  previewSql,
  run,
  onStop,
}: {
  conn_id: string;
  tab_key: string;
  database: string | undefined;
  tab: OutputTab;
  onTab: (t: OutputTab) => void;
  clause: Clause | null;
  ordinal: number;
  preview: ClausePreview | undefined;
  /** The selected card's preview query, for the grid's query view. */
  previewSql: string;
  run: BuilderRun | null;
  onStop?: () => void;
}) {
  const name = clause ? `Card ${ordinal}, ${CLAUSE_LABEL[clause.kind]}` : "";
  return (
    <BottomPanel
      label="Query output"
      tab={tab}
      onTab={onTab}
      tabs={[
        { value: "card", label: "Card output" },
        { value: "run", label: "Run result" },
      ]}
      summary={
        tab === "card"
          ? clause
            ? `${name}: up to ${PREVIEW_SHOW} rows of its preview`
            : "Select a card to see its rows"
          : run
            ? runSummary(run, ROWS)
            : "Run the query to see its full result"
      }
    >
      {tab === "card" ? (
        <CardOutput
          conn_id={conn_id}
          tab_key={tab_key}
          database={database}
          clause={clause}
          preview={preview}
          previewSql={previewSql}
        />
      ) : run ? (
        <div className="flex h-full min-h-0 flex-col">
          {run.error && <PanelError message={run.error} />}
          <div className="min-h-0 flex-1">
            <RunGrid
              run={run}
              onStop={onStop}
              conn_id={conn_id}
              grid_key={`${tab_key}:run`}
              query_text={run.command}
              query_language="sql"
              database={database}
            />
          </div>
        </div>
      ) : (
        <PanelMessage>
          Run streams the whole query, with no cap, into this view.
        </PanelMessage>
      )}
    </BottomPanel>
  );
}

function CardOutput({
  conn_id,
  tab_key,
  database,
  clause,
  preview,
  previewSql,
}: {
  conn_id: string;
  tab_key: string;
  database: string | undefined;
  clause: Clause | null;
  preview: ClausePreview | undefined;
  previewSql: string;
}) {
  const chunk = preview?.chunk;
  if (!clause)
    return (
      <PanelMessage>
        Select a card on the canvas to see up to {PREVIEW_SHOW} of the rows
        after it.
      </PanelMessage>
    );
  if (!chunk)
    return (
      <PanelMessage>
        {preview?.status === "running"
          ? "Previewing…"
          : "This card has no preview yet."}
      </PanelMessage>
    );
  if (chunk.error) return <PanelError message={chunk.error} />;
  if (chunk.rows.length === 0)
    return <PanelMessage>No rows come out of this card.</PanelMessage>;
  return (
    <PreviewGrid
      columns={chunk.columns}
      rows={chunk.rows}
      elapsed_ms={chunk.elapsed_ms}
      conn_id={conn_id}
      grid_key={`${tab_key}:card`}
      query_text={previewSql}
      query_language="sql"
      database={database}
    />
  );
}
