import { useMemo, useState } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/** One entry in a review-before-apply dialog, shaped for a real unified-diff
 *  rendering: "add" sets only `after` (one green line), "drop" sets only
 *  `before` (one red line), "alter" sets both — full reconstructed lines,
 *  not just the changed fragment, so it reads like a real line diff instead
 *  of a fragment list. The single shared shape (and the single dialog below)
 *  is used everywhere in the app something needs a "here's what's about to
 *  change" review — the data grid's pending row edits and the schema
 *  designer's DDL batch — so the visual language never diverges between
 *  them. */
export interface DiffChange {
  id: string;
  kind: "add" | "drop" | "alter";
  /** Small muted label above the diff lines, e.g. "row", "column", "index". */
  entity: string;
  /** The name/identifier this change is about. */
  title: string;
  before?: string;
  after?: string;
}

export function ApplyChangesDialog({
  title = "Review changes",
  changes,
  /** Per-item checkboxes to exclude entries before applying — only safe
   *  when every change is independent of the others (the grid's row/cell
   *  edits). Schema DDL isn't: a trigger edit is a drop+create pair, an
   *  index rebuild follows a column rename — excluding half of a pair would
   *  silently build broken SQL, so that caller renders without selection,
   *  an all-or-nothing gate instead of a picker. */
  selectable = false,
  applying = false,
  on_apply,
  on_close,
}: {
  title?: string;
  changes: DiffChange[];
  selectable?: boolean;
  applying?: boolean;
  on_apply: (keepIds: Set<string>) => void;
  on_close: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(changes.map((c) => c.id)),
  );

  const counts = useMemo(() => {
    let add = 0,
      alter = 0,
      drop = 0;
    for (const c of changes) {
      if (selectable && !selected.has(c.id)) continue;
      if (c.kind === "add") add++;
      else if (c.kind === "alter") alter++;
      else drop++;
    }
    return { add, alter, drop };
  }, [changes, selected, selectable]);

  const all = changes.length;
  const checked = selectable ? selected.size : all;
  const some = selectable && checked > 0 && checked < all;

  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggle_all = (on: boolean) =>
    setSelected(on ? new Set(changes.map((c) => c.id)) : new Set());

  const confirm = () => {
    on_apply(
      selectable ? new Set(selected) : new Set(changes.map((c) => c.id)),
    );
    on_close();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !applying && on_close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {selectable
              ? `${all} staged change${all === 1 ? "" : "s"}. Uncheck anything you don’t want to apply.`
              : `${all} change${all === 1 ? "" : "s"} will run as one transaction — all or nothing.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4 text-xs">
          {selectable && (
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5">
              <Checkbox
                checked={all > 0 && checked === all}
                onCheckedChange={(v) => toggle_all(v === true)}
                indeterminate={some}
              />
              Select all
            </label>
          )}
          <span className="text-muted-foreground flex items-center gap-1.5 font-mono">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{counts.add}
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              ~{counts.alter}
            </span>
            <span className="text-red-600 dark:text-red-400">
              -{counts.drop}
            </span>
          </span>
        </div>

        <div className="max-h-96 divide-y overflow-y-auto rounded-md border">
          {changes.map((c) => (
            <DiffHunk
              key={c.id}
              change={c}
              selectable={selectable}
              selected={selected.has(c.id)}
              on_toggle={(on) => toggle(c.id, on)}
            />
          ))}
          {changes.length === 0 && (
            <div className="text-muted-foreground p-6 text-center text-sm">
              No changes to review.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={applying} onClick={on_close}>
            Cancel
          </Button>
          <Button disabled={applying || checked === 0} onClick={confirm}>
            {applying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Apply {checked} change{checked === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One "hunk": a collapsible heading (entity + name) over one or two full
 *  diff lines. `before`/`after` are each rendered as their OWN full line —
 *  a complete reconstructed value/definition, not just the changed
 *  fragment — so an alter reads as a real line replace (red line directly
 *  above green), matching how GitHub/VS Code render a modified line.
 *  Starts expanded — collapsing is for skimming past changes you already
 *  trust (a long trigger body, a bulk of untouched-looking row edits), not
 *  for hiding anything by default. */
function DiffHunk({
  change: c,
  selectable,
  selected,
  on_toggle,
}: {
  change: DiffChange;
  selectable: boolean;
  selected: boolean;
  on_toggle: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-3 py-2",
        selectable && !selected && "opacity-50",
      )}
    >
      {selectable && (
        <Checkbox
          className="mt-1"
          checked={selected}
          onCheckedChange={(v) => on_toggle(v === true)}
          aria-label="Include this change"
        />
      )}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="text-muted-foreground mb-1 flex w-full items-baseline gap-1.5 text-left text-[10px] tracking-wide uppercase"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 self-center transition-transform",
              open && "rotate-90",
            )}
          />
          <span>{c.entity}</span>
          <span className="text-foreground/70 min-w-0 truncate normal-case">
            {c.title}
          </span>
        </button>
        {open && (
          <div className="overflow-hidden rounded border font-mono text-[12.5px] leading-5">
            {c.before !== undefined && <DiffLine sign="-" text={c.before} />}
            {c.after !== undefined && <DiffLine sign="+" text={c.after} />}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffLine({ sign, text }: { sign: "+" | "-"; text: string }) {
  return (
    <div
      className={cn(
        "flex gap-2 px-2 py-1",
        sign === "+"
          ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          : "bg-red-500/10 text-red-800 dark:text-red-300",
      )}
    >
      <span className="w-3 shrink-0 opacity-70 select-none">{sign}</span>
      <span className="min-w-0 break-all whitespace-pre-wrap">{text}</span>
    </div>
  );
}
