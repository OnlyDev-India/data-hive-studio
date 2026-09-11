import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

export interface DdlDialogState {
  kind: "db-create" | "db-drop" | "schema-create" | "schema-drop";
  name: string;
}

export function DropDialog({
  open,
  on_open_change,
  noun,
  name,
  error,
  busy,
  on_confirm,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  noun: string;
  name: string;
  error: string | null;
  busy: boolean;
  on_confirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Drop {noun}</DialogTitle>
          <DialogDescription>
            This permanently deletes the {noun} “{name}” and its data. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="destructive" disabled={busy} onClick={on_confirm}>
            {busy ? "Dropping…" : "Drop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DuplicateDialog({
  open,
  on_open_change,
  name,
  value,
  on_value_change,
  error,
  submitting,
  on_confirm,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  name: string;
  value: string;
  on_value_change: (v: string) => void;
  error: string | null;
  submitting: boolean;
  on_confirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate table</DialogTitle>
          <DialogDescription>
            Create a copy of “{name}” with all of its data.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="dupe-name">Name of the duplicate</Label>
          <Input
            id="dupe-name"
            placeholder="table_copy"
            value={value}
            onChange={(e) => on_value_change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") on_confirm();
            }}
            autoFocus
          />
        </div>
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button disabled={submitting} onClick={on_confirm}>
            {submitting ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** MongoDB's duplicate dialog: a timestamped default name and a copy-data
 *  checkbox instead of the SQL dialog's always-copies-data "_copy" flow.
 *  Indexes are always copied either way. */
export function DuplicateMongoDialog({
  open,
  on_open_change,
  name,
  value,
  on_value_change,
  copy_data,
  on_copy_data_change,
  error,
  submitting,
  on_confirm,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  name: string;
  value: string;
  on_value_change: (v: string) => void;
  copy_data: boolean;
  on_copy_data_change: (v: boolean) => void;
  error: string | null;
  submitting: boolean;
  on_confirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate collection</DialogTitle>
          <DialogDescription>
            Create a copy of “{name}”. Indexes are always copied; documents only
            if you choose to below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="dupe-mongo-name">Name of the duplicate</Label>
          <Input
            id="dupe-mongo-name"
            placeholder="collection_20260101_120000"
            value={value}
            onChange={(e) => on_value_change(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") on_confirm();
            }}
            autoFocus
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={copy_data}
            onCheckedChange={(v) => on_copy_data_change(v === true)}
          />
          Copy all documents too
        </label>
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button disabled={submitting} onClick={on_confirm}>
            {submitting ? "Duplicating…" : "Duplicate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Relation grants (Postgres). */
export function GrantsDialog({
  open,
  on_open_change,
  name,
  rows,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  name: string | null;
  rows: (string | null)[][] | null;
}) {
  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Grants — {name}</DialogTitle>
        </DialogHeader>
        {rows === null ? (
          <p className="text-muted-foreground py-2 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground py-2 text-sm">
            No explicit grants.
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded-md border">
            {rows.map(([grantee, privilege], i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
              >
                <span className="truncate font-mono">{grantee}</span>
                <span className="text-muted-foreground shrink-0 uppercase">
                  {privilege}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
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
          <DialogTitle>
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
                <p className="text-muted-foreground text-sm">
                  Permanently drop{" "}
                  <span className="text-foreground font-mono">
                    {dialog.name}
                  </span>
                  ?
                </p>
                {dialog.kind === "schema-drop" && (
                  <label className="flex items-center gap-2 text-sm">
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
              <p className="wrap-break-words text-destructive font-mono text-xs">
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
