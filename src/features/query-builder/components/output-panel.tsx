import {
  BottomPanel,
  PanelError,
  PanelMessage,
  PreviewGrid,
  RunGrid,
  runSummary,
} from "@/shared/components/builder-canvas";
import type { Clause } from "@/shared/store";
import { PREVIEW_SHOW } from "../lib/compose";
import { CLAUSE_LABEL } from "../lib/model";
import type { QueryRun } from "../lib/use-query-runs";
import type { ClausePreview } from "../lib/use-sql-previews";

/** The selected card's preview, or one run query's result. */
export type OutputTab = "card" | `run:${string}`;

const ROWS: [string, string] = ["row", "rows"];

const plural = (n: number, noun: [string, string]) =>
  `${n.toLocaleString()} ${n === 1 ? noun[0] : noun[1]}`;

/** What one run query's tab says about it. */
function runLine(run: QueryRun): string {
  if (run.status === "queued") return "Waiting for the queries before it";
  if (run.status === "not_run")
    return "Not run: an earlier query failed or was stopped";
  if (run.running || run.cancelled || run.error || run.is_select)
    return runSummary(run, ROWS);
  const returned = run.snapshot?.row_count
    ? `, ${plural(run.snapshot.row_count, ["row", "rows"])} returned`
    : "";
  const time = run.elapsed_ms !== null ? ` in ${run.elapsed_ms} ms` : "";
  return `${plural(run.rows_affected, ["row", "rows"])} affected${returned}${time}`;
}

/** Under the canvas: the selected card's preview rows, or a tab per run
 *  query with its result. */
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
  noPreview,
  runs,
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
  /** The selected card is in a write or statement query, which never
   *  previews. */
  noPreview: boolean;
  /** Each run query's last run, in the order they first ran. */
  runs: { id: string; run: QueryRun }[];
  onStop?: () => void;
}) {
  const name = clause ? `Card ${ordinal}, ${CLAUSE_LABEL[clause.kind]}` : "";
  const shown = runs.find((r) => `run:${r.id}` === tab);
  const current: OutputTab = tab === "card" || shown ? tab : "card";
  return (
    <BottomPanel
      label="Query output"
      tab={current}
      onTab={onTab}
      tabs={[
        { value: "card", label: "Card output" },
        ...runs.map((r) => ({
          value: `run:${r.id}` as OutputTab,
          label: r.run.label,
        })),
      ]}
      summary={
        shown
          ? runLine(shown.run)
          : clause
            ? noPreview
              ? `${name}: no preview`
              : `${name}: up to ${PREVIEW_SHOW} rows of its preview`
            : runs.length === 0
              ? "Select a card to see its rows, or run a query"
              : "Select a card to see its rows"
      }
    >
      {shown ? (
        <RunOutput
          key={shown.id}
          conn_id={conn_id}
          grid_key={`${tab_key}:run:${shown.id}`}
          database={database}
          run={shown.run}
          onStop={onStop}
        />
      ) : (
        <CardOutput
          conn_id={conn_id}
          tab_key={tab_key}
          database={database}
          clause={clause}
          preview={preview}
          previewSql={previewSql}
          noPreview={noPreview}
        />
      )}
    </BottomPanel>
  );
}

function RunOutput({
  conn_id,
  grid_key,
  database,
  run,
  onStop,
}: {
  conn_id: string;
  grid_key: string;
  database: string | undefined;
  run: QueryRun;
  onStop?: () => void;
}) {
  if (run.status === "queued" || run.status === "not_run")
    return <PanelMessage>{runLine(run)}.</PanelMessage>;
  const rows = run.running || !!run.snapshot;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {run.error && <PanelError message={run.error} />}
      {rows ? (
        <div className="min-h-0 flex-1">
          <RunGrid
            run={run}
            onStop={onStop}
            conn_id={conn_id}
            grid_key={grid_key}
            query_text={run.command}
            query_language="sql"
            database={database}
          />
        </div>
      ) : (
        !run.error && <PanelMessage>{runLine(run)}.</PanelMessage>
      )}
    </div>
  );
}

function CardOutput({
  conn_id,
  tab_key,
  database,
  clause,
  preview,
  previewSql,
  noPreview,
}: {
  conn_id: string;
  tab_key: string;
  database: string | undefined;
  clause: Clause | null;
  preview: ClausePreview | undefined;
  previewSql: string;
  noPreview: boolean;
}) {
  const chunk = preview?.chunk;
  if (!clause)
    return (
      <PanelMessage>
        Select a card on the canvas to see up to {PREVIEW_SHOW} of the rows
        after it.
      </PanelMessage>
    );
  if (noPreview)
    return (
      <PanelMessage>
        Write queries and SQL statements never preview. Run the query to see how
        many rows it changed, and any rows it returns.
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
