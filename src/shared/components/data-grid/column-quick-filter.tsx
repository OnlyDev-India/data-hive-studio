import { useMemo, useRef, useState } from "react";
import { Filter, Loader2, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import type { GridFilter } from "./types";

/** Header's per-column, Excel-style distinct-value checkbox quick filter.
 *  `fallback_values` (the currently loaded page's own distinct values for
 *  this column) paint instantly; if `fetch_all` is given, a live DB query
 *  runs in the background so columns whose full domain isn't on the loaded
 *  page still filter correctly — same `SelectDistinct` op the enum/bool
 *  dropdown editors already use, just unbounded. NULL is intentionally not
 *  a checkbox option — `is null`/`is not null` in the main filter bar cover
 *  that, and `FilterOp::In` (Rust) only ever carries non-null values. */
export function ColumnQuickFilter({
  col,
  fallback_values,
  fetch_all,
  active_filter,
  on_apply,
  on_clear,
}: {
  col: string;
  fallback_values: (string | null)[];
  fetch_all?: (col: string) => Promise<(string | null)[]>;
  active_filter: GridFilter | undefined;
  on_apply: (values: string[]) => void;
  on_clear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [values, setValues] = useState(fallback_values);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const str_values = useMemo(
    () => [...new Set(values.filter((v): v is string => v !== null))],
    [values],
  );

  // A generation token instead of an effect's cleanup flag — the fetch is
  // kicked off from the popover's own open handler (a real event, not a
  // passive effect), so there's no cleanup callback to cancel it from; the
  // token just makes a late-arriving response from a since-closed/reopened
  // popover a no-op.
  const fetch_token = useRef(0);

  const handle_open_change = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setQuery("");
      return;
    }
    const token = ++fetch_token.current;
    setValues(fallback_values);
    setSelected(
      new Set(
        active_filter?.values ??
          fallback_values.filter((v): v is string => v !== null),
      ),
    );
    if (!fetch_all) return;
    setLoading(true);
    fetch_all(col)
      .then((full) => {
        if (fetch_token.current !== token) return;
        setValues(full);
        if (!active_filter) {
          setSelected(new Set(full.filter((v): v is string => v !== null)));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (fetch_token.current === token) setLoading(false);
      });
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? str_values.filter((v) => v.toLowerCase().includes(q))
    : str_values;
  const active = !!active_filter;

  return (
    <Popover open={open} onOpenChange={handle_open_change}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "flex w-full cursor-pointer items-center justify-start gap-2 px-2 py-1.5",
              active && "text-info",
            )}
          />
        }
      >
        <Filter className="size-3.5 shrink-0" />
        Filter values
        {active && (
          <span className="text-2xs ml-auto shrink-0 opacity-80">
            {active_filter!.values?.length ?? 0}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="flex w-60 flex-col gap-2 p-2" align="start">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search values…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-2 px-0.5">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-2xs h-5 px-1.5"
            onClick={() => setSelected(new Set(str_values))}
          >
            Select all
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-2xs h-5 px-1.5"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          {loading && (
            <Loader2 className="text-muted-foreground ml-auto size-3 animate-spin" />
          )}
        </div>
        <div className="flex max-h-60 flex-col overflow-y-auto">
          {filtered.length === 0 && !loading && (
            <p className="text-muted-foreground px-2 py-3 text-center text-xs">
              No values.
            </p>
          )}
          {filtered.map((v) => (
            <label
              key={v}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs"
            >
              <Checkbox
                checked={selected.has(v)}
                onCheckedChange={(c) =>
                  setSelected((cur) => {
                    const next = new Set(cur);
                    if (c) next.add(v);
                    else next.delete(v);
                    return next;
                  })
                }
              />
              <span className="truncate">{v}</span>
            </label>
          ))}
        </div>
        <div className="flex justify-between gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!active}
            onClick={() => {
              on_clear();
              setOpen(false);
            }}
          >
            Clear filter
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              on_apply([...selected]);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
