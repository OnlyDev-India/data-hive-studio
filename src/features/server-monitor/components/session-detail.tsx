import { useState } from "react";
import { Check, Copy, FileCode, ListTree, SquareTerminal, X } from "lucide-react";
import type { MonitorEngine, SessionRow } from "@/shared/api";
import { QueryEditor } from "@/shared/components/query-editor";
import { Button } from "@/shared/components/ui/button";
import {
  ACTION_LABEL,
  displayDuration,
  formatDuration,
  rowActions,
  type RowAction,
} from "../lib/sessions";
import { StateBadge, ThisAppTag } from "./badges";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-caption font-medium">{label}</dt>
      <dd className="text-small truncate font-mono" title={value ?? undefined}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

/** Explain cannot plan a statement whose `$1` style parameters have no
 *  values (AC-8). */
export function hasDollarParams(text: string): boolean {
  return /\$\d+/.test(text);
}

/** When a duration in milliseconds ago started, as local time. */
function startedAgo(ms: number | null, received_at: number | null): string | null {
  if (ms === null || received_at === null) return null;
  return new Date(received_at - ms).toLocaleString();
}

/** The selected session (AC-8): the full query in a read only editor, where
 *  it comes from, and what you can do with it. */
export function SessionDetail({
  row,
  engine,
  locked,
  received_at,
  on_close,
  on_action,
  on_open_in_editor,
  on_explain,
}: {
  row: SessionRow;
  engine: MonitorEngine;
  locked: boolean;
  received_at: number | null;
  on_close: () => void;
  on_action: (row: SessionRow, a: RowAction) => void;
  on_open_in_editor: (row: SessionRow) => void;
  on_explain: (row: SessionRow) => void;
}) {
  const [copied, setCopied] = useState(false);
  const actions = rowActions(row, engine, locked);
  const off_reason = actions.find((a) => !a.enabled)?.reason;
  const text = row.query ?? "";
  const hidden = row.query_hidden || !row.query;
  const hidden_title = row.query_hidden
    ? "The server hides this session's query from you"
    : "This session has no query text";
  const explain_title = hidden
    ? hidden_title
    : hasDollarParams(text)
      ? "Explain needs real values for the $1 style parameters"
      : "Open a SQL tab that runs EXPLAIN on this query (never ANALYZE)";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable: nothing to show
    }
  };

  return (
    <aside
      aria-label={`Session ${row.id}`}
      className="bg-background flex w-[26rem] max-w-[45%] shrink-0 flex-col border-l"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <h2 className="text-body font-mono font-semibold">
          {engine === "postgres" ? "pid" : "opid"} {row.id}
        </h2>
        <StateBadge state={row.state} />
        {row.is_this_app && <ThisAppTag />}
        <Button
          variant="ghost"
          size="iconXs"
          className="ml-auto"
          aria-label="Close details"
          title="Close details (Esc)"
          onClick={on_close}
        >
          <X className="size-3.5" />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="User" value={row.user} />
          <Field label="Database" value={row.database} />
          <Field label="Duration" value={formatDuration(displayDuration(row))} />
          <Field label="Client" value={row.client} />
          <Field label="App name" value={row.app_name} />
          <Field label={engine === "postgres" ? "Wait event" : "Waiting"} value={row.wait} />
          {engine === "postgres" ? (
            <>
              <Field label="Backend start" value={row.backend_start} />
              <Field
                label="Transaction start"
                value={startedAgo(row.xact_ms, received_at)}
              />
            </>
          ) : (
            <>
              <Field label="Op type" value={row.op_type} />
              <Field label="Shard" value={row.shard} />
            </>
          )}
        </dl>

        <section className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <h3 className="text-muted-foreground text-caption font-medium">Query</h3>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              disabled={hidden}
              title={hidden ? hidden_title : "Copy the query"}
              onClick={() => void copy()}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {hidden ? (
            <p className="text-muted-foreground text-small rounded-control border border-dashed p-3 italic">
              {row.query_hidden ? "Hidden by the server" : "No query text"}
            </p>
          ) : (
            <QueryEditor
              value={text}
              onChange={() => {}}
              onRun={() => {}}
              onRunTarget={() => {}}
              readOnly
              disableWrapping={false}
              disableContextMenu
              language={engine === "mongodb" ? "js" : "sql"}
              className="rounded-control max-h-72 overflow-auto border"
            />
          )}
        </section>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={hidden}
            title={hidden ? hidden_title : undefined}
            onClick={() => on_open_in_editor(row)}
          >
            {engine === "postgres" ? (
              <FileCode className="size-3.5" />
            ) : (
              <SquareTerminal className="size-3.5" />
            )}
            Open in editor
          </Button>
          {engine === "postgres" && (
            <Button
              variant="outline"
              size="sm"
              disabled={hidden || hasDollarParams(text)}
              title={explain_title}
              onClick={() => on_explain(row)}
            >
              <ListTree className="size-3.5" />
              Explain
            </Button>
          )}
        </div>

        {actions.length > 0 && (
          <section className="flex flex-col gap-2 border-t pt-3">
            <h3 className="text-muted-foreground text-caption font-medium">Stop it</h3>
            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={a.action}
                  variant={a.action === "cancel" ? "outline" : "destructive"}
                  size="sm"
                  disabled={!a.enabled}
                  title={a.reason}
                  onClick={() => on_action(row, a)}
                >
                  {ACTION_LABEL[a.action]}…
                </Button>
              ))}
            </div>
            {off_reason && (
              <p className="text-muted-foreground text-caption">{off_reason}</p>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
