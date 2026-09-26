import { useState, type ReactNode } from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Columns3,
  Copy,
  Info,
  Rows3,
} from "lucide-react";
import { resultRowCount, type QueryResult } from "@/shared/api";
import { cn } from "@/shared/lib/utils";

export function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className="text-muted-foreground hover:text-foreground hover:bg-muted shrink-0 rounded p-1"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-card rounded-lg border px-3.5 py-3">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** At a glance view of one result: how it went, the key numbers, the full
 *  error when it failed, and a preview of the statement. */
export function ResultSummary({
  result,
  query_text,
  message,
  on_view_query,
}: {
  result: QueryResult;
  query_text: string;
  message?: string;
  on_view_query?: () => void;
}) {
  const failed = !!result.error;
  const rows = result.is_select ? resultRowCount(result) : result.rows_affected;
  const time = formatElapsed(result.elapsed_ms);
  const detail = failed
    ? `Stopped after ${time}`
    : result.is_select
      ? `Returned ${plural(rows, "row")} in ${time}`
      : `Affected ${plural(rows, "row")} in ${time}`;

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-selectable>
      <div className="flex max-w-3xl flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              failed
                ? "bg-destructive/10 text-destructive"
                : "bg-success/10 text-success",
            )}
          >
            {failed ? (
              <CircleAlert className="size-5" />
            ) : (
              <CircleCheck className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {failed ? "Query failed" : "Query succeeded"}
            </div>
            <div className="text-muted-foreground text-xs">{detail}</div>
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
          <Stat
            icon={<Rows3 className="size-3.5" />}
            label={result.is_select ? "Rows returned" : "Rows affected"}
            value={rows.toLocaleString()}
          />
          <Stat
            icon={<Clock className="size-3.5" />}
            label="Duration"
            value={time}
          />
          {result.is_select && (
            <Stat
              icon={<Columns3 className="size-3.5" />}
              label="Columns"
              value={result.columns.length.toLocaleString()}
            />
          )}
        </div>

        {result.error && (
          <div className="border-destructive/30 bg-destructive/5 rounded-lg border">
            <div className="text-destructive flex items-center justify-between gap-2 px-3.5 pt-2.5 text-xs font-medium">
              Error
              <CopyButton text={result.error} label="Copy error" />
            </div>
            <pre className="text-destructive max-h-64 overflow-auto px-3.5 pt-1 pb-3 font-mono text-xs whitespace-pre-wrap">
              {result.error}
            </pre>
          </div>
        )}

        {message && (
          <div className="bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-xs">
            <Info className="mt-px size-3.5 shrink-0" />
            {message}
          </div>
        )}

        <div className="rounded-lg border">
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-b px-3.5 py-2 text-xs font-medium">
            Statement
            {on_view_query && (
              <button
                type="button"
                onClick={on_view_query}
                className="hover:text-foreground text-xs font-normal underline-offset-2 hover:underline"
              >
                View full query
              </button>
            )}
          </div>
          <pre className="line-clamp-4 px-3.5 py-2.5 font-mono text-xs whitespace-pre-wrap">
            {query_text.trim() || "(empty)"}
          </pre>
        </div>
      </div>
    </div>
  );
}
