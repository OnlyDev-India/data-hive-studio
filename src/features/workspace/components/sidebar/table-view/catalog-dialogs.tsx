import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export interface DdlDialogState {
  kind: "db-create" | "db-drop" | "schema-create" | "schema-drop";
  name: string;
}

/** Create/drop database or schema (Postgres). */
export function DbSchemaDdlDialog({
  dialog,
  name_value,
  on_name_change,
  cascade,
  on_cascade_change,
  busy,
  error,
  on_cancel,
  on_confirm,
}: {
  dialog: DdlDialogState | null;
  name_value: string;
  on_name_change: (v: string) => void;
  cascade: boolean;
  on_cascade_change: (v: boolean) => void;
  busy: boolean;
  error: string | null;
  /** The connection's label and lock (spec 0007), shown in the title. */
  on_cancel: () => void;
  on_confirm: () => void;
}) {
  return (
    <Dialog
      open={dialog !== null}
      onOpenChange={(o) => {
        if (!o && !busy) on_cancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {dialog?.kind === "db-create" && "Create database"}
            {dialog?.kind === "db-drop" && "Drop database"}
            {dialog?.kind === "schema-create" && "Create schema"}
            {dialog?.kind === "schema-drop" && "Drop schema"}
          </DialogTitle>
        </DialogHeader>
        {dialog && (
          <div className="flex flex-col gap-3">
            {(dialog.kind === "db-create" ||
              dialog.kind === "schema-create") && (
              <Input
                autoFocus
                value={name_value}
                onChange={(e) => on_name_change(e.target.value)}
                placeholder={
                  dialog.kind === "db-create" ? "database name" : "schema name"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") on_confirm();
                }}
              />
            )}
            {dialog.kind.endsWith("-drop") && (
              <>
                <p className="text-muted-foreground text-body">
                  Permanently drop{" "}
                  <span className="text-foreground font-mono">
                    {dialog.name}
                  </span>
                  ?
                </p>
                {dialog.kind === "schema-drop" && (
                  <label className="text-body flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={cascade}
                      onChange={(e) => on_cascade_change(e.target.checked)}
                    />
                    CASCADE — also drop every object inside it
                  </label>
                )}
              </>
            )}
            {error && (
              <p className="wrap-break-words text-destructive text-small font-mono">
                {error}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={on_cancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={dialog?.kind.endsWith("-drop") ? "destructive" : "default"}
            disabled={busy}
            onClick={on_confirm}
          >
            {busy
              ? "Working…"
              : dialog?.kind.endsWith("-drop")
                ? "Drop"
                : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
