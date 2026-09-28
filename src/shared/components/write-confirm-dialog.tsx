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

/** One thing about to run, with every reason it needs a second look. A
 *  statement that is both a write on a Production connection and an UPDATE
 *  with no WHERE carries both reasons here, so it is one row in one dialog. */
export interface ConfirmItem {
  /** The statement, or a plain description of the change. */
  text: string;
  reasons: string[];
}

/** Blocks a write until the user explicitly confirms. Used when a statement
 *  is unconditionally destructive (see `dangerous-sql.ts`) and when the
 *  connection asks before every write (a Production label, or Confirm before
 *  writes, spec 0007): a plain yes/no gate, the whole batch or nothing, with
 *  the environment chip in the title so it is clear where it will run. */
export function WriteConfirmDialog({
  items,
  description,
  title = "Confirm before running",
  confirmLabel = "Run anyway",
  onConfirm,
  onCancel,
}: {
  /** `null` closes the dialog. */
  items: ConfirmItem[] | null;
  /** The line under the title. */
  description: string;
  /** The connection's label and lock, shown as a chip beside the title. */
  title?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = items !== null;
  useShortcuts([{ key: "Enter", handler: onConfirm }], { enabled: open });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive size-4" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="bg-muted/30 flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border p-3 text-sm">
          {items?.map((item, i) => (
            <li key={i} className="flex flex-col gap-0.5">
              <code className="wrap-break-words font-mono text-xs">
                {item.text}
              </code>
              {item.reasons.map((reason) => (
                <span key={reason} className="text-destructive text-xs">
                  {reason}
                </span>
              ))}
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
            {confirmLabel}
            <kbd className="bg-muted text-muted-foreground text-3xs ml-1 rounded-md border px-1.5 py-0.5 font-medium">
              <CornerDownLeft className="size-4" strokeWidth={1.75} />
            </kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
