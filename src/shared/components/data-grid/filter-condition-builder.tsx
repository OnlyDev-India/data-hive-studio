import { Fragment, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { DatePicker } from "./date-picker";
import {
  FILTER_OPS,
  filterConfigFor,
  type DistinctMap,
  type FilterOp,
  type GridFilter,
} from "./types";
export interface FilterColumn {
  name: string;
  data_type: string;
}

export const NEEDS_VALUE: FilterOp[] = [
  "eq",
  "neq",
  "contains",
  "starts_with",
  "ends_with",
  "gt",
  "gte",
  "lt",
  "lte",
];

export const OP_LABEL: Record<FilterOp, string> = Object.fromEntries(
  FILTER_OPS.map((o) => [o.value, o.label]),
) as Record<FilterOp, string>;

/** AND/OR selector that joins one condition to the previous one. */
export function ConjunctionToggle({
  value,
  onChange,
}: {
  value: "AND" | "OR";
  onChange: (v: "AND" | "OR") => void;
}) {
  return (
    <div className="bg-muted flex shrink-0 items-center gap-1 rounded-md p-0.5">
      {(["AND", "OR"] as const).map((c) => (
        <Button
          key={c}
          type="button"
          variant={value === c ? "default" : "ghost"}
          size="sm"
          className={cn(
            "text-2xs h-5 cursor-pointer rounded px-2 py-0.5 font-semibold",
            value !== c && "text-muted-foreground",
          )}
          onClick={() => onChange(c)}
        >
          {c}
        </Button>
      ))}
    </div>
  );
}

export function FilterValueInput({
  kind,
  value,
  distinct_values,
  onChange,
}: {
  kind: "text" | "number" | "bool" | "date" | "datetime" | "dropdown";
  value: string;
  distinct_values: (string | null)[];
  onChange: (v: string) => void;
}) {
  if (kind === "date" || kind === "datetime") {
    return (
      <DatePicker
        value={value || null}
        withTime={kind === "datetime"}
        onChange={(v) => onChange(v ?? "")}
      />
    );
  }
  if (kind === "bool" || kind === "dropdown") {
    const options =
      kind === "bool"
        ? distinct_values.length
          ? distinct_values
          : ["1", "0"]
        : distinct_values;
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger className="w-full" size="sm">
          <SelectValue
            placeholder={kind === "bool" ? "Value" : "Pick a value…"}
          />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o ?? "null"} value={o ?? ""}>
              {o ?? "NULL"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      type={kind === "number" ? "number" : "text"}
      className="w-full"
      placeholder="value…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export interface FilterConditionBuilderProps {
  columns: FilterColumn[];
  distinct: DistinctMap;
  filters: GridFilter[];
  on_add: (filter: Omit<GridFilter, "id">) => void;
  on_remove: (id: number) => void;
  on_set_conjunction: (id: number, conjunction: "AND" | "OR") => void;
  /** Omit to hide the "Clear all" button entirely (e.g. a one-shot condition
   *  builder that starts empty every time, like the bulk-edit dialog). */
  on_clear?: () => void;
}

/** The column/op/value condition-list builder shared by `FilterBar`'s "UI"
 *  tab and the bulk-edit dialog's "condition" mode — same `GridFilter` shape
 *  both ends of the app already speak (the grid's own applied filters, and
 *  a bulk-update's WHERE predicate), so this is the one place that shape of
 *  UI exists rather than two drifting copies of it. */
export function FilterConditionBuilder({
  columns,
  distinct,
  filters,
  on_add,
  on_remove,
  on_set_conjunction,
  on_clear,
}: FilterConditionBuilderProps) {
  // The column list can arrive after this mounts (the table's structure is
  // fetched behind its rows), so the pick falls back to the first column
  // instead of freezing whatever was there on the first render.
  const [picked_column, setColumn] = useState("");
  const column = columns.some((c) => c.name === picked_column)
    ? picked_column
    : (columns[0]?.name ?? "");
  const [op, setOp] = useState<FilterOp>("eq");
  const [value, setValue] = useState("");
  const [conjunction, setConjunction] = useState<"AND" | "OR">("AND");

  const col = columns.find((c) => c.name === column);
  const config = filterConfigFor((col?.data_type ?? "").toLowerCase());
  const needs_value = NEEDS_VALUE.includes(op);
  const distinct_values = col ? (distinct[col.name] ?? []) : [];

  const pick_column = (name: string) => {
    setColumn(name);
    const next = columns.find((c) => c.name === name);
    const cfg = filterConfigFor((next?.data_type ?? "").toLowerCase());
    if (!cfg.ops.includes(op)) setOp(cfg.ops[0]);
    setValue("");
  };

  const apply = () => {
    if (!column) return;
    if (needs_value && value.trim() === "") return;
    on_add({ column, op, value, conjunction });
    setValue("");
  };

  return (
    <>
      {filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((f, i) => (
            <Fragment key={f.id}>
              {i > 0 && (
                <ConjunctionToggle
                  value={f.conjunction ?? "AND"}
                  onChange={(c) => on_set_conjunction(f.id, c)}
                />
              )}
              <Badge variant="secondary" className="max-w-full">
                <span className="truncate">{f.column}</span>
                <span className="text-muted-foreground mx-1">
                  {OP_LABEL[f.op]}
                </span>
                {f.op === "in" ? (
                  <span className="text-foreground/80 truncate font-normal">
                    {(f.values ?? []).length} selected
                  </span>
                ) : (
                  NEEDS_VALUE.includes(f.op) && (
                    <span className="text-foreground/80 truncate font-normal">
                      {f.value || "NULL"}
                    </span>
                  )
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="iconXs"
                  onClick={() => on_remove(f.id)}
                  aria-label="Remove condition"
                  className="text-muted-foreground hover:text-foreground ml-1 size-4 shrink-0 p-0 opacity-60 hover:opacity-100"
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            </Fragment>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        {filters.length > 0 && (
          <ConjunctionToggle value={conjunction} onChange={setConjunction} />
        )}
        <Select value={column} onValueChange={(v) => pick_column(v ?? "")}>
          <SelectTrigger className="w-full min-w-0 flex-1" size="sm">
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
        <Select value={op} onValueChange={(v) => setOp(v as FilterOp)}>
          <SelectTrigger className="w-full min-w-0 flex-1" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {config.ops.map((o) => (
              <SelectItem key={o} value={o}>
                {OP_LABEL[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {needs_value && (
          <div className="w-full min-w-0 flex-1">
            <FilterValueInput
              kind={config.valueKind}
              value={value}
              distinct_values={distinct_values}
              onChange={setValue}
            />
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2">
        {on_clear && (
          <Button
            size="sm"
            variant="ghost"
            disabled={filters.length === 0}
            onClick={on_clear}
          >
            Clear all
          </Button>
        )}
        <Button
          size="sm"
          disabled={!column || (needs_value && value.trim() === "")}
          onClick={apply}
          className="ml-auto"
        >
          Add condition
        </Button>
      </div>
    </>
  );
}
