import { useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  Zap,
} from "lucide-react";
import {
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/shared/components/ui/accordion";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { trigger_name_from_sql, type TriggerDraft } from "./drafts";

/** Editable "Triggers" accordion section. SQLite has no ALTER TRIGGER, so an
 *  edit is staged as a drop + create pair (applied atomically with the rest
 *  of the batch). */
export function TriggersPanel({
  trigs,
  disabled = false,
  on_update,
  on_replace,
}: {
  /** Draft triggers for this table (mirrors schema.triggers until edited). */
  trigs: TriggerDraft[];
  /** True while an Apply is in flight — all editing is locked. */
  disabled?: boolean;
  on_update: (id: string, patch: Partial<TriggerDraft>) => void;
  on_replace: (updater: (ts: TriggerDraft[]) => TriggerDraft[]) => void;
}) {
  const [editing, setEditing] = useState<TriggerDraft | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <AccordionItem value="triggers">
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          <Zap className="size-4" />
          Triggers
          <Badge variant="muted">{trigs.length}</Badge>
          {trigs.some(
            (t) => t.dropped || t.orig_name === null || t.sql !== t.orig_sql,
          ) && <Badge variant="warning">edited</Badge>}
        </span>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="overflow-hidden rounded-md border">
          {trigs.map((t) => (
            <TriggerRow
              key={t.id}
              trig={t}
              disabled={disabled}
              on_update={on_update}
              on_edit={() => setEditing(t)}
              on_replace={on_replace}
            />
          ))}
          <button
            type="button"
            disabled={disabled}
            className="text-muted-foreground hover:bg-muted/50 flex w-full items-center gap-2 border-t px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3.5" />
            Add trigger
          </button>
        </div>

        {/* Mounted only while open — fresh textarea state per dialog. */}
        {adding && (
          <TriggerSqlDialog
            open
            title="Add trigger"
            description="Write the full CREATE TRIGGER statement — the name is taken from the SQL."
            sql=""
            on_close={() => setAdding(false)}
            on_save={(sql) => {
              on_replace((ts) => [
                ...ts,
                {
                  id: `n${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  orig_name: null,
                  orig_sql: null,
                  sql,
                  dropped: false,
                },
              ]);
              setAdding(false);
            }}
          />
        )}
        {editing && (
          <TriggerSqlDialog
            open
            title="Edit trigger"
            description={`Applies as DROP TRIGGER ${editing.orig_name ?? "(new)"} + the new CREATE TRIGGER.`}
            sql={editing.sql}
            on_close={() => setEditing(null)}
            on_save={(sql) => {
              on_update(editing.id, { sql });
              setEditing(null);
            }}
          />
        )}
      </AccordionPanel>
    </AccordionItem>
  );
}

function TriggerRow({
  trig,
  disabled = false,
  on_update,
  on_edit,
  on_replace,
}: {
  trig: TriggerDraft;
  disabled?: boolean;
  on_update: (id: string, patch: Partial<TriggerDraft>) => void;
  on_edit: () => void;
  on_replace: (updater: (ts: TriggerDraft[]) => TriggerDraft[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const name = trigger_name_from_sql(trig.sql) || trig.orig_name || "(unnamed)";
  const timing =
    /(\bBEFORE\b|\bAFTER\b|INSTEAD\s+OF)/i.exec(trig.sql)?.[0]?.toUpperCase() ??
    "";
  const event =
    /\b(?:before|after|instead\s+of)?\s*(INSERT|UPDATE|DELETE)\b/i
      .exec(
        trig.sql.slice(trig.sql.toUpperCase().indexOf(" TRIGGER ") + 9),
      )?.[1]
      ?.toUpperCase() ?? "";

  const copy_sql = async () => {
    try {
      await navigator.clipboard.writeText(trig.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const dirty =
    trig.dropped || trig.orig_name === null || trig.sql !== trig.orig_sql;

  return (
    <div
      className={`border-b text-sm last:border-0 ${trig.dropped ? "opacity-50" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-label={open ? "Hide trigger SQL" : "Show trigger SQL"}
          aria-expanded={open}
          className="hover:bg-muted flex min-w-0 items-center gap-1 rounded"
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown
            className={`size-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span
            className={`truncate font-medium ${trig.dropped ? "line-through" : ""}`}
          >
            {name}
          </span>
        </button>
        {!trig.dropped &&
          dirty &&
          trig.orig_name !== null &&
          trig.sql !== trig.orig_sql && <Badge variant="warning">edited</Badge>}
        {!trig.dropped && trig.orig_name === null && (
          <Badge variant="warning">new</Badge>
        )}
        {!trig.dropped && timing && <Badge variant="info">{timing}</Badge>}
        {!trig.dropped && event && <Badge variant="muted">{event}</Badge>}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Copy trigger SQL"
            title="Copy trigger SQL"
            onClick={copy_sql}
          >
            {copied ? (
              <Check className="text-success-dark size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Edit trigger"
            title="Edit trigger SQL"
            disabled={disabled}
            onClick={on_edit}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label={trig.dropped ? "Restore trigger" : "Drop trigger"}
            title={trig.dropped ? "Restore trigger" : "Drop trigger"}
            disabled={disabled}
            onClick={() => on_update(trig.id, { dropped: !trig.dropped })}
          >
            {trig.dropped ? (
              <Undo2 className="size-3.5" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
          {/* Remove a not-yet-applied draft outright. */}
          {trig.orig_name === null && (
            <Button
              variant="ghost"
              size="iconXs"
              aria-label="Remove draft trigger"
              title="Remove draft trigger"
              onClick={() =>
                on_replace((ts) => ts.filter((x) => x.id !== trig.id))
              }
            >
              ×
            </Button>
          )}
        </div>
      </div>
      {open && (
        <pre className="bg-muted/60 mx-3 mb-3 overflow-x-auto rounded-md p-2 font-mono text-xs leading-relaxed whitespace-pre">
          {trig.sql}
        </pre>
      )}
    </div>
  );
}

const NAME_HINT = "Name is parsed from the CREATE TRIGGER statement.";

/** Modal with one SQL textarea for composing or editing a whole trigger. */
function TriggerSqlDialog({
  open,
  title,
  description,
  sql: initial_sql,
  on_close,
  on_save,
}: {
  open: boolean;
  title: string;
  description: string;
  sql: string;
  on_close: () => void;
  on_save: (sql: string) => void;
}) {
  const [text, setText] = useState(initial_sql);
  const [localError, setLocalError] = useState<string | null>(null);

  // The parent mounts this dialog fresh per open (conditional render), so
  // useState(initial_sql) is the reseed — no effect needed.

  const parsed_name = trigger_name_from_sql(text);

  const save = () => {
    if (!text.trim()) {
      setLocalError("Trigger SQL is required.");
      return;
    }
    if (!parsed_name) {
      setLocalError(
        "Could not find a trigger name — the SQL must be a CREATE TRIGGER statement.",
      );
      return;
    }
    on_save(text.trim());
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) on_close();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {localError && (
            <div className="border-destructive bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
              {localError}
            </div>
          )}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            aria-label="Trigger SQL"
            placeholder={
              "CREATE TRIGGER my_trigger\nAFTER INSERT ON table_name\nFOR EACH ROW\nBEGIN\n  ...\nEND"
            }
            className="focus-visible:ring-ring/50 min-h-40 w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-xs outline-none focus-visible:ring-2"
          />
          <span className="text-muted-foreground text-xs">
            {parsed_name ? (
              <>
                Name:{" "}
                <code className="bg-muted rounded px-1.5 py-0.5">
                  {parsed_name}
                </code>{" "}
                · {NAME_HINT}
              </>
            ) : (
              NAME_HINT
            )}
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={on_close}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
