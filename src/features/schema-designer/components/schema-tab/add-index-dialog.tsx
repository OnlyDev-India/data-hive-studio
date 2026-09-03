import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
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

/** Everything needed to construct a fresh `IdxDraft` for a newly-created
 *  index. `column_dirs` is parallel to `columns`. */
export interface NewIndexDraft {
  name: string;
  unique: boolean;
  columns: string[];
  column_dirs: number[];
  sparse: boolean;
  ttl_seconds: number | null;
  partial_filter: string;
}

/** Modal for composing a brand-new index: name, UNIQUE flag, column picks,
 *  and — for MongoDB — per-column sort direction, sparse, TTL, and a partial
 *  filter (none of which have a SQL equivalent, so `mongo` hides them). */
export function AddIndexDialog({
  open,
  on_close,
  columns,
  on_create,
  mongo = false,
}: {
  open: boolean;
  on_close: () => void;
  columns: string[];
  on_create: (draft: NewIndexDraft) => void;
  mongo?: boolean;
}) {
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dirs, setDirs] = useState<Record<string, number>>({});
  const [sparse, setSparse] = useState(false);
  const [ttl_text, setTtlText] = useState("");
  const [partial_filter, setPartialFilter] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setUnique(false);
    setSelected([]);
    setDirs({});
    setSparse(false);
    setTtlText("");
    setPartialFilter("");
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
    const ttl_seconds =
      mongo && ttl_text.trim() !== "" ? Number(ttl_text) : null;
    if (ttl_seconds !== null && (!Number.isFinite(ttl_seconds) || ttl_seconds < 0)) {
      setLocalError("TTL must be a non-negative number of seconds.");
      return;
    }
    on_create({
      name: name.trim(),
      unique,
      columns: [...selected],
      column_dirs: selected.map((c) => dirs[c] ?? 1),
      sparse: mongo && sparse,
      ttl_seconds,
      partial_filter: mongo ? partial_filter.trim() : "",
    });
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
          {mongo && (
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={sparse}
                onCheckedChange={(v) => setSparse(v === true)}
                aria-label="Sparse"
              />
              Sparse index (skip documents missing the field)
            </label>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs font-medium">
              Columns{mongo ? " (click to flip sort direction)" : ""}
            </span>
            {columns.length === 0 ? (
              <span className="text-muted-foreground text-sm">
                No columns available.
              </span>
            ) : (
              columns.map((col) => (
                <div key={col} className="flex items-center gap-2 text-sm">
                  <label className="flex flex-1 items-center gap-2">
                    <Checkbox
                      checked={selected.includes(col)}
                      onCheckedChange={() => toggle(col)}
                    />
                    {col}
                  </label>
                  {mongo && selected.includes(col) && (
                    <button
                      type="button"
                      title={`Sort ${(dirs[col] ?? 1) < 0 ? "descending" : "ascending"} — click to flip`}
                      className="bg-muted text-muted-foreground hover:text-foreground flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs"
                      onClick={() =>
                        setDirs((d) => ({
                          ...d,
                          [col]: (d[col] ?? 1) < 0 ? 1 : -1,
                        }))
                      }
                    >
                      {(dirs[col] ?? 1) < 0 ? (
                        <>
                          <ArrowDown className="size-3" /> desc
                        </>
                      ) : (
                        <>
                          <ArrowUp className="size-3" /> asc
                        </>
                      )}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
          {mongo && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs font-medium">
                  TTL — expire documents after (seconds, optional)
                </span>
                <Input
                  type="number"
                  min={0}
                  value={ttl_text}
                  onChange={(e) => setTtlText(e.target.value)}
                  placeholder="e.g. 3600"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs font-medium">
                  Partial filter expression (optional)
                </span>
                <Input
                  value={partial_filter}
                  onChange={(e) => setPartialFilter(e.target.value)}
                  placeholder={'e.g. { "status": "active" }'}
                  className="font-mono"
                />
              </label>
            </>
          )}
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
