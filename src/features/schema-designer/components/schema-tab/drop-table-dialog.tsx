import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { executeOp } from "@/shared/api";
import { useStudioStore } from "@/shared/store";

/** Confirm dialog for dropping the table. Controlled: the trigger lives in
 *  the status bar (SchemaPaneHandle.drop), the dialog itself stays mounted in
 *  the schema editor. Outcome is reported through the notification center. */
export function DropTableDialog({
  conn_id,
  table,
  open,
  on_open_change,
  on_dropped,
  /** "table" (SQL) or "collection" (MongoDB) — only the wording differs, the
   *  op is the same generic `QueryOp::DropTable` either way. */
  object_noun = "table",
}: {
  conn_id: string;
  table: string;
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_dropped: () => void;
  object_noun?: "table" | "collection";
}) {
  const [dropping, setDropping] = useState(false);
  const push_notification = useStudioStore((s) => s.pushNotification);

  const do_drop = async () => {
    if (dropping) return;
    setDropping(true);
    try {
      await executeOp(conn_id, { kind: "drop_table", table });
      push_notification({
        kind: "success",
        title: `${object_noun === "table" ? "Table" : "Collection"} “${table}” dropped`,
      });
      on_dropped();
    } catch (e) {
      console.error(`drop ${object_noun} failed`, e);
      push_notification({
        kind: "error",
        title: `Failed to drop ${object_noun} “${table}”`,
        detail: String(e),
      });
    } finally {
      setDropping(false);
      on_open_change(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Drop {object_noun}</DialogTitle>
          <DialogDescription>
            This permanently deletes the {object_noun} “{table}” and its data.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => on_open_change(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={dropping}
            onClick={() => void do_drop()}
          >
            {dropping ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Drop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
