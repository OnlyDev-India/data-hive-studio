import { useMemo, useState } from "react";
import { ArrowRight, Check, Plus, Trash2 } from "lucide-react";
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
import type { PendingChange } from "./grid-context";

/** Render a stored cell value as text; NULL is shown as an explicit "NULL". */
function cell(v: string | null | undefined): string {
  return v === null || v === undefined ? "NULL" : v;
}

/** Review-and-confirm dialog shown before buffered grid edits are applied.
 *  Every staged change (new row / cell edit / row delete) is listed with a
 *  checkbox; unchecking one removes it from the batch before confirming. */
export function ApplyChangesDialog({
  changes,
  on_apply,
  on_close,
}: {
  changes: PendingChange[];
  on_apply: (keepIds: Set<string>) => void;
  on_close: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(changes.map((c) => c.id)),
  );

  const counts = useMemo(() => {
    let ins = 0,
      upd = 0,
      del = 0;
    for (const c of changes) {
      if (selected.has(c.id)) {
        if (c.kind === "insert") ins++;
        else if (c.kind === "update") upd++;
        else del++;
      }
    }
    return { ins, upd, del };
  }, [changes, selected]);

  const all = changes.length;
  const checked = selected.size;
  const some = checked > 0 && checked < all;

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
    on_apply(new Set(selected));
    on_close();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && on_close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>
            {all} staged change{all === 1 ? "" : "s"} for this table. Uncheck
            anything you don’t want to apply.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox
              checked={all > 0 && checked === all}
              onCheckedChange={(v) => toggle_all(v === true)}
              indeterminate={some}
            />
            Select all
          </label>
          <span className="text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{counts.ins} new
            </span>
            {" · "}
            <span className="text-amber-600 dark:text-amber-400">
              {counts.upd} edit{counts.upd === 1 ? "" : "s"}
            </span>
            {" · "}
            <span className="text-red-600 dark:text-red-400">
              {counts.del} deletion{counts.del === 1 ? "" : "s"}
            </span>
          </span>
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border">
          {changes.map((c) => {
            const on = selected.has(c.id);
            return (
              <div
                key={c.id}
                className={cn(
                  "flex items-start gap-3 border-b px-3 py-2 last:border-b-0",
                  !on && "opacity-50",
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={on}
                  onCheckedChange={(v) => toggle(c.id, v === true)}
                  aria-label="Include this change"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ChangeBadge kind={c.kind} />
                    <span className="truncate font-medium text-sm">
                      {c.kind === "insert"
                        ? "New row"
                        : c.kind === "delete"
                          ? `Row ${c.row}`
                          : `Row ${c.row} · ${c.column}`}
                    </span>
                  </div>
                  {c.kind === "update" && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs">
                      <span className="text-muted-foreground line-through decoration-red-400/60">
                        {cell(c.before)}
                      </span>
                      <ArrowRight className="size-3 text-muted-foreground" />
                      <span className="text-foreground">
                        {cell(c.after)}
                      </span>
                    </div>
                  )}
                  {(c.kind === "insert" || c.kind === "delete") &&
                    c.values &&
                    c.value_columns &&
                    c.value_columns
                      .map((col, i) => [col, c.values?.[i]] as const)
                      .filter(
                        ([, v]) => c.kind === "delete" || (v !== null && v !== ""),
                      )
                      .map(([col, v]) => (
                        <div
                          key={col}
                          className="mt-1 font-mono text-xs text-muted-foreground"
                        >
                          <span
                            className={
                              c.kind === "delete"
                                ? "text-red-600 dark:text-red-400"
                                : "text-amber-600 dark:text-amber-400"
                            }
                          >
                            {col}
                          </span>
                          : {cell(v)}
                        </div>
                      ))}
                </div>
              </div>
            );
          })}
          {changes.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No changes to review.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={on_close}>
            Cancel
          </Button>
          <Button disabled={checked === 0} onClick={confirm}>
            <Check className="size-4" />
            Apply {checked} change{checked === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChangeBadge({ kind }: { kind: PendingChange["kind"] }) {
  const Icon = kind === "insert" ? Plus : kind === "delete" ? Trash2 : ArrowRight;
  const cls =
    kind === "insert"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : kind === "delete"
        ? "bg-red-500/15 text-red-600 dark:text-red-400"
        : "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      <Icon className="size-3" />
      {kind}
    </span>
  );
}
