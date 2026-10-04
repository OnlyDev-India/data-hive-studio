import { useState } from "react";
import { AlertTriangle, CornerDownLeft } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
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
  onCancel,
  ...rest
}: {
  /** `null` closes the dialog. */
  items: ConfirmItem[] | null;
  /** The line under the title. */
  description: string;
  /** The connection's label and lock, shown as a chip beside the title. */
  title?: string;
  confirmLabel?: string;
  /** A name the user types before Confirm unlocks, for the riskiest writes. */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={items !== null} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        {items && <ConfirmBody items={items} onCancel={onCancel} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

/** Mounted per open, so the typed name starts empty every time. */
function ConfirmBody({
  items,
  description,
  title = "Confirm before running",
  confirmLabel = "Run anyway",
  typeToConfirm,
  onConfirm,
  onCancel,
}: {
  items: ConfirmItem[];
  description: string;
  title?: string;
  confirmLabel?: string;
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const unlocked = !typeToConfirm || typed === typeToConfirm;
  useShortcuts([{ key: "Enter", handler: onConfirm }], { enabled: unlocked });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="text-destructive size-4" />
          {title}
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <ul className="bg-muted/30 rounded-control text-body flex max-h-64 flex-col gap-2 overflow-y-auto border p-3">
        {items?.map((item, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <code className="wrap-break-words text-small font-mono">
              {item.text}
            </code>
            {item.reasons.map((reason) => (
              <span key={reason} className="text-destructive text-small">
                {reason}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {typeToConfirm && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="write-confirm-typed" className="text-small">
            Type <code className="font-mono">{typeToConfirm}</code> to confirm
          </Label>
          <Input
            id="write-confirm-typed"
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="font-mono"
          />
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
          <kbd className="bg-muted text-muted-foreground text-caption rounded-control ml-1 border px-1.5 py-0.5 font-medium">
            ESC
          </kbd>
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={!unlocked}>
          {confirmLabel}
          <kbd className="bg-muted text-muted-foreground text-caption rounded-control ml-1 border px-1.5 py-0.5 font-medium">
            <CornerDownLeft className="size-4" strokeWidth={1.75} />
          </kbd>
        </Button>
      </DialogFooter>
    </>
  );
}
