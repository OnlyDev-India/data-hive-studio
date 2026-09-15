import { AlertTriangle, CornerDownLeft } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import { useShortcuts } from "@/shared/hooks/use-shortcut";

export interface DangerousStatement {
  text: string;
  reason: string;
}

/** Blocks a run when one or more of its statements are unconditionally
 *  destructive (see `dangerous-sql.ts`) until the user explicitly confirms —
 *  same "review before it's too late" spirit as the grid's
 *  `ApplyChangesDialog`, but a plain yes/no gate rather than a per-change
 *  diff review, since there's nothing to selectively apply here: it's the
 *  whole batch or nothing. */
export function DangerConfirmDialog({
  statements,
  onConfirm,
  onCancel,
}: {
  /** `null` closes the dialog. */
  statements: DangerousStatement[] | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = statements !== null;
  useShortcuts([{ key: "Enter", handler: onConfirm }], { enabled: open });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-4" />
            Confirm before running
          </DialogTitle>
          <DialogDescription>
            {statements?.length === 1
              ? "This statement looks unconditionally destructive:"
              : `${statements?.length ?? 0} statements in this run look unconditionally destructive:`}
          </DialogDescription>
        </DialogHeader>
        <ul className="bg-muted/30 flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border p-3 text-sm">
          {statements?.map((s, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <code className="wrap-break-words font-mono text-xs">
                {s.text}
              </code>
              <span className="text-destructive text-xs">{s.reason}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
            <kbd className="bg-muted text-muted-foreground text-3xs ml-1 rounded-md border px-1.5 py-0.5 font-medium">
              ESC
            </kbd>
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Run anyway
            <kbd className="bg-muted text-muted-foreground text-3xs ml-1 rounded-md border px-1.5 py-0.5 font-medium">
              <CornerDownLeft className="size-4" strokeWidth={1.75} />
            </kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
