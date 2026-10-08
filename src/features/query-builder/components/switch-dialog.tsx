import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/** Asks what happens to the cards when the database or schema changes. */
export function SwitchDialog({
  to,
  onKeep,
  onClear,
  onCancel,
}: {
  /** The database or schema picked, as shown; null keeps it closed. */
  to: string | null;
  onKeep: () => void;
  onClear: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={to !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Switch to {to}?</DialogTitle>
          <DialogDescription>
            Keep the cards to run them against {to}; a table that isn't there
            shows its error on its card. Or clear them and start from an empty
            FROM. To keep a copy of this query, cancel and use Open in SQL
            editor first.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onClear}>
            Clear cards
          </Button>
          <Button onClick={onKeep}>Keep cards</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
