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
  /** The connection's label and lock (spec 0007): this dialog is the
   *  confirmation before a drop, so it says where the drop will run. */
  on_confirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Drop {noun}
          </DialogTitle>
          <DialogDescription>
            This permanently deletes the {noun} “{name}” and its data. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-control text-body border px-3 py-2">
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
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-control text-body border px-3 py-2">
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
        <label className="text-body flex items-center gap-2">
          <Checkbox
            checked={copy_data}
            onCheckedChange={(v) => on_copy_data_change(v === true)}
          />
          Copy all documents too
        </label>
        {error && (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-control text-body border px-3 py-2">
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
          <p className="text-muted-foreground text-body py-2">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-body py-2">
            No explicit grants.
          </p>
        ) : (
          <ul className="rounded-control max-h-64 overflow-y-auto border">
            {rows.map(([grantee, privilege], i) => (
              <li
                key={i}
                className="text-small flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-b-0"
              >
                <span className="truncate font-mono">{grantee}</span>
                <span className="text-muted-foreground shrink-0 font-mono">
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
