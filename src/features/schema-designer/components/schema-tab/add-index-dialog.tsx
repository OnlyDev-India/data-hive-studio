import { useState } from "react";
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
import { Input } from "@/shared/components/ui/input";
import { Switch } from "@/shared/components/ui/switch";

/** Modal for composing a brand-new index: name, UNIQUE flag, column picks. */
export function AddIndexDialog({
  open,
  on_close,
  columns,
  on_create,
}: {
  open: boolean;
  on_close: () => void;
  columns: string[];
  on_create: (name: string, unique: boolean, columns: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setUnique(false);
    setSelected([]);
    setLocalError(null);
  };

  const toggle = (col: string) => {
    setSelected((s) =>
      s.includes(col) ? s.filter((c) => c !== col) : [...s, col],
    );
  };

  const create = () => {
    if (!name.trim()) {
      setLocalError("Index name is required.");
      return;
    }
    if (selected.length === 0) {
      setLocalError("Pick at least one column.");
      return;
    }
    on_create(name.trim(), unique, [...selected]);
    reset();
    on_close();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          on_close();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add index</DialogTitle>
          <DialogDescription>
            Create a new index on one or more columns.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {localError && (
            <div className="border-destructive bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
              {localError}
            </div>
          )}
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="index name"
            aria-label="Index name"
          />
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={unique}
              onCheckedChange={(v) => setUnique(v === true)}
              aria-label="Unique"
            />
            Unique index
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs font-medium">
              Columns
            </span>
            {columns.length === 0 ? (
              <span className="text-muted-foreground text-sm">
                No columns available.
              </span>
            ) : (
              columns.map((col) => (
                <label key={col} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.includes(col)}
                    onCheckedChange={() => toggle(col)}
                  />
                  {col}
                </label>
              ))
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={on_close}>
            Cancel
          </Button>
          <Button onClick={create}>Create index</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
