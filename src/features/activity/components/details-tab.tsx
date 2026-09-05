import { Check, Copy, History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { useStudioStore } from "@/shared/store";
import { cn } from "@/shared/lib/utils";
import { QueryEditor } from "@/features/query-editor";

const KIND_LABELS: Record<string, string> = {
  select: "SELECT",
  count: "COUNT",
  distinct: "DISTINCT",
  insert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
  drop_table: "DROP TABLE",
  sql: "SQL",
  ddl: "DDL",
  duplicate: "DUPLICATE",
  schema: "SCHEMA",
  connect: "CONNECT",
  disconnect: "DISCONNECT",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="wrap-break-words font-mono text-xs">{children}</span>
    </div>
  );
}

/** The singleton Activity details tab: shows whichever entry was last
 *  clicked in this connection's activity feed. Renders nothing useful until
 *  an entry is selected (or when the selected entry belongs to a different
 *  connection). */
export function ActivityDetailsTab({
  conn_id,
  tab_key,
}: {
  conn_id: string;
  tab_key: string;
}) {
  const detail = useStudioStore((s) => s.activityDetail);
  const [copied, setCopied] = useState(false);

  // The slot is global; only render it for the connection it came from.
  const entry = detail && detail.conn_id === conn_id ? detail.entry : null;

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-muted-foreground max-w-sm text-sm">
          Click any command in the Activity feed to inspect it here — its
          statement, timing, affected rows and error details.
        </p>
      </div>
    );
  }

  const copy = () => {
    const text = [entry.sql ?? entry.target, entry.error]
      .filter(Boolean)
      .join("\n\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="h-full overflow-y-auto" key={tab_key}>
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
        <div className="flex items-center gap-2">
          <History className="text-muted-foreground size-4 shrink-0" />
          <h2 className="min-w-0 truncate font-mono text-sm font-semibold">
            {entry.target}
          </h2>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label={copied ? "Copied" : "Copy"}
            onClick={copy}
            className="ml-auto shrink-0"
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>

        {/* Full statement — the whole reason this tab exists for SQL runs. */}
        {entry.sql && (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              Statement
            </span>
            <QueryEditor
              value={entry.sql || ""}
              onChange={() => {}}
              onRun={() => {}}
              onRunTarget={() => {}}
              readOnly={true}
              className="rounded-md border"
            />
            {/* <pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-break-words rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
              {entry.sql}
            </pre> */}
          </div>
        )}

        <div
          className={cn(
            "rounded-md border p-3",
            entry.ok
              ? "bg-background"
              : "border-destructive/40 bg-destructive/5",
          )}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-1.5 py-px text-[11px] font-semibold",
              entry.ok
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/15 text-red-600 dark:text-red-400",
            )}
          >
            {entry.ok ? "OK" : "FAILED"}
            <span className="font-normal opacity-70">·</span>
            <span className="font-normal">
              {KIND_LABELS[entry.kind] ?? entry.kind.toUpperCase()}
            </span>
          </span>
          {entry.error && (
            <p className="wrap-break-words text-destructive mt-2 font-mono text-xs whitespace-pre-wrap">
              {entry.error}
            </p>
          )}
        </div>

        {!entry.sql && (
          <p className="text-muted-foreground text-xs">
            Connection-level command — no SQL statement was involved.
          </p>
        )}

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Field label="Started">
            {new Date(entry.ts_ms).toLocaleTimeString([], { hour12: false })}
            <span className="text-muted-foreground">
              {" "}
              · {new Date(entry.ts_ms).toLocaleDateString()}
            </span>
          </Field>
          <Field label="Duration">
            {entry.duration_ms < 1
              ? "<1 ms"
              : entry.duration_ms < 1000
                ? `${Math.round(entry.duration_ms)} ms`
                : `${(entry.duration_ms / 1000).toFixed(1)} s`}
          </Field>
          <Field label="Rows">{entry.rows > 0 ? `${entry.rows}` : "—"}</Field>
          <Field label="Connection">{detail!.conn_id.slice(0, 8)}</Field>
          <Field label="Command id">#{entry.id}</Field>
        </div>
      </div>
    </div>
  );
}
