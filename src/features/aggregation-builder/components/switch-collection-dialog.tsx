import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/** Asks before another collection replaces a pipeline that is not saved. */
export function SwitchCollectionDialog({
  to,
  canSave,
  onCancel,
  onDiscard,
  onSave,
}: {
  /** The collection picked; null keeps the dialog closed. */
  to: string | null;
  /** False on the web build, or while the pipeline has errors. */
  canSave: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <Dialog
      open={to !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Switch to {to}?</DialogTitle>
          <DialogDescription>
            The builder starts an empty pipeline on {to}. You'll lose the
            pipeline on the canvas unless you save it first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDiscard} disabled={saving}>
            Discard and switch
          </Button>
          {canSave && (
            <Button
              disabled={saving}
              onClick={() => {
                setSaving(true);
                void onSave().finally(() => setSaving(false));
              }}
            >
              Save and switch
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
