import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import type { QueryResult } from "@/shared/api";
import { QueryResultsGrid } from "@/shared/components/data-grid/query-results-grid";
import { cn } from "@/shared/lib/utils";
import type { BuilderRun } from "./use-builder-run";

export function Segmented<T extends string>({
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

/** Under the canvas: a switch between the panel's views, a line saying what
 *  shows, an optional control on the right, and the view itself. */
export function BottomPanel<T extends string>({
  label,
  tab,
  tabs,
  onTab,
  summary,
  aside,
  children,
}: {
  label: string;
  tab: T;
  tabs: { value: T; label: string }[];
  onTab: (t: T) => void;
  summary: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="bg-background flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <div className="bg-editor-toolbar flex shrink-0 items-center gap-2 border-b px-3 py-1">
        <Segmented label="Output" value={tab} onChange={onTab} options={tabs} />
        <span className="text-muted-foreground text-small min-w-0 truncate">
          {summary}
        </span>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function PanelMessage({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground text-body flex h-full items-center justify-center p-6 text-center">
      {children}
    </p>
  );
}

export function PanelError({ message }: { message: string }) {
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

/** "1,204 rows in 87 ms", or how the run ended. */
export function runSummary(run: BuilderRun, noun: [string, string]): string {
  if (run.running) return run.stopping ? "Stopping…" : "Running…";
  const n = run.snapshot?.row_count ?? 0;
  const count = `${n.toLocaleString()} ${n === 1 ? noun[0] : noun[1]}`;
  if (run.cancelled) return `Stopped after ${count}`;
  if (run.error) return "The run failed";
  return run.elapsed_ms !== null ? `${count} in ${run.elapsed_ms} ms` : count;
}

interface GridContext {
  conn_id: string;
  /** The grid's own key, unique per tab and view. */
  grid_key: string;
  database?: string;
  query_text: string;
  query_language: "sql" | "js";
}

/** A card's preview rows in the console's grid. */
export function PreviewGrid({
  columns,
  rows,
  elapsed_ms,
  ...ctx
}: GridContext & {
  columns: string[];
  rows: (string | null)[][];
  elapsed_ms: number;
}) {
  const result: QueryResult = {
    columns,
    rows,
    rows_affected: 0,
    is_select: true,
    error: null,
    elapsed_ms,
  };
  return (
    <QueryResultsGrid
      result={result}
      conn_id={ctx.conn_id}
      tab_key={ctx.grid_key}
      query_text={ctx.query_text}
      query_language={ctx.query_language}
      database={ctx.database}
    />
  );
}

/** The full Run result in the console's grid, filling in as it streams. */
export function RunGrid({
  run,
  onStop,
  ...ctx
}: GridContext & { run: BuilderRun; onStop?: () => void }) {
  const snap = run.snapshot;
  if (!snap && !run.running) return null;
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
    <QueryResultsGrid
      result={result}
      conn_id={ctx.conn_id}
      tab_key={ctx.grid_key}
      query_text={ctx.query_text}
      query_language={ctx.query_language}
      database={ctx.database}
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
  );
}
