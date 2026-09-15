import { useState } from "react";
import { AlertTriangle } from "lucide-react";
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
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { executeOp } from "@/shared/api";
import type { DistinctMap, GridFilter } from "./types";
import {
  FilterConditionBuilder,
  type FilterColumn,
} from "./filter-condition-builder";

/** Set one value across the current cell selection, or — a real, immediate
 *  UPDATE / `updateMany`, not a buffered grid edit — across every row in the
 *  table matching a condition (built with the exact same `FilterConditionBuilder`
 *  the WHERE filter bar uses, so it's one condition-list UI, not two). The
 *  condition mode requires at least one condition (no unscoped "every row in
 *  the table" footgun) and a Preview step before the Update button unlocks,
 *  re-armed whenever the condition/value changes after previewing.
 *
 *  Scoped down: the condition mode has no raw WHERE/Mongo-JSON override —
 *  only the structured filter list — unlike the WHERE filter bar's dual
 *  structured+raw layout. Add one if the structured builder ever isn't
 *  expressive enough for a bulk edit. */
export function BulkEditDialog({
  open,
  onOpenChange,
  conn_id,
  table,
  columns,
  distinct,
  selected_count,
  on_apply_selection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conn_id: string;
  table: string;
  columns: FilterColumn[];
  distinct: DistinctMap;
  /** Number of currently-selected cells in the grid — labels/gates the
   *  "Selection" mode. */
  selected_count: number;
  /** Buffer `value` into every currently-selected cell (client-side, same
   *  review-before-Apply flow as any other grid edit). */
  on_apply_selection: (value: string | null) => void;
}) {
  const [mode, setMode] = useState<"selection" | "condition">("selection");

  // ---- Selection mode ----
  const [sel_value, setSelValue] = useState("");
  const [sel_null, setSelNull] = useState(false);

  // ---- Condition mode ----
  const [column, setColumn] = useState(columns[0]?.name ?? "");
  const [value, setValue] = useState("");
  const [set_null, setSetNull] = useState(false);
  const [filters, setFilters] = useState<GridFilter[]>([]);
  const next_id = useState(() => ({ current: 0 }))[0];
  const [preview, setPreview] = useState<{
    signature: string;
    count: number;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<
    { ok: true; rows_affected: number } | { ok: false; error: string } | null
  >(null);

  const signature = JSON.stringify({ column, value, set_null, filters });
  const previewed = preview?.signature === signature;

  const reset = () => {
    setMode("selection");
    setSelValue("");
    setSelNull(false);
    setColumn(columns[0]?.name ?? "");
    setValue("");
    setSetNull(false);
    setFilters([]);
    setPreview(null);
    setResult(null);
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  const run_preview = async () => {
    setPreviewing(true);
    setResult(null);
    try {
      const res = await executeOp(conn_id, {
        kind: "count",
        table,
        filters,
      });
      const count = Number(res.rows[0]?.[0] ?? 0);
      setPreview({ signature, count });
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setPreviewing(false);
    }
  };

  const run_update = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await executeOp(conn_id, {
        kind: "bulk_update",
        table,
        column,
        value: set_null ? null : value,
        filters,
      });
      setResult({ ok: true, rows_affected: res.rows_affected });
      setPreview(null);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk edit</DialogTitle>
          <DialogDescription>
            Set one value across the current selection, or on every row matching
            a condition.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-muted flex shrink-0 items-center gap-1 rounded-md p-0.5">
          {(
            [
              ["selection", `Selection (${selected_count})`],
              ["condition", "Condition"],
            ] as const
          ).map(([m, label]) => (
            <Button
              key={m}
              type="button"
              variant={mode === m ? "default" : "ghost"}
              size="sm"
              className="flex-1"
              onClick={() => setMode(m)}
            >
              {label}
            </Button>
          ))}
        </div>

        {mode === "selection" ? (
          <div className="flex flex-col gap-3 overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Value</Label>
              <Input
                value={sel_value}
                disabled={sel_null}
                onChange={(e) => setSelValue(e.target.value)}
                placeholder="value…"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sel_null}
                onCheckedChange={(v) => setSelNull(v === true)}
              />
              Set to NULL
            </label>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Column</Label>
                <Select
                  value={column}
                  onValueChange={(v) => setColumn(v ?? "")}
                >
                  <SelectTrigger className="w-36" size="sm">
                    <SelectValue placeholder="Column" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label className="text-xs">New value</Label>
                <Input
                  value={value}
                  disabled={set_null}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="value…"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={set_null}
                onCheckedChange={(v) => setSetNull(v === true)}
              />
              Set to NULL
            </label>

            <Label className="text-xs">Where</Label>
            <FilterConditionBuilder
              columns={columns}
              distinct={distinct}
              filters={filters}
              on_add={(f) =>
                setFilters((cur) => [...cur, { ...f, id: ++next_id.current }])
              }
              on_remove={(id) =>
                setFilters((cur) => cur.filter((f) => f.id !== id))
              }
              on_set_conjunction={(id, c) =>
                setFilters((cur) =>
                  cur.map((f) => (f.id === id ? { ...f, conjunction: c } : f)),
                )
              }
            />

            {filters.length === 0 && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <AlertTriangle className="size-3.5 shrink-0" />
                At least one condition is required — this can't run against
                every row in the table.
              </p>
            )}

            {preview && previewed && (
              <p className="text-sm">
                This will update{" "}
                <span className="font-semibold">{preview.count}</span> row
                {preview.count === 1 ? "" : "s"}.
              </p>
            )}
            {result &&
              (result.ok ? (
                <p className="text-success text-sm">
                  Updated {result.rows_affected} row
                  {result.rows_affected === 1 ? "" : "s"}.
                </p>
              ) : (
                <p className="text-destructive text-sm">{result.error}</p>
              ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {result?.ok ? "Done" : "Cancel"}
          </Button>
          {mode === "selection" ? (
            <Button
              disabled={selected_count === 0 || (!sel_null && sel_value === "")}
              onClick={() => {
                on_apply_selection(sel_null ? null : sel_value);
                close();
              }}
            >
              Set {selected_count} cell{selected_count === 1 ? "" : "s"}
            </Button>
          ) : previewed ? (
            <Button
              variant="destructive"
              disabled={
                running || filters.length === 0 || (!set_null && value === "")
              }
              onClick={() => void run_update()}
            >
              {running
                ? "Updating…"
                : `Update ${preview.count} row${preview.count === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <Button
              disabled={
                previewing ||
                filters.length === 0 ||
                (!set_null && value === "") ||
                !column
              }
              onClick={() => void run_preview()}
            >
              {previewing ? "Previewing…" : "Preview"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
