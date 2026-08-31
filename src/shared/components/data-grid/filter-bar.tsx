import { Fragment, useState } from "react";
import { Brain, Filter, PencilLine, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Separator } from "@/shared/components/ui/separator";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
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

interface FilterBarProps {
  columns: FilterColumn[];
  distinct: DistinctMap;
  filters: GridFilter[];
  custom_where: string;
  on_add: (filter: Omit<GridFilter, "id">) => void;
  on_remove: (id: number) => void;
  on_set_conjunction: (id: number, conjunction: "AND" | "OR") => void;
  on_clear: () => void;
  on_custom_where: (where: string) => void;
}

const NEEDS_VALUE: FilterOp[] = [
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

const OP_LABEL: Record<FilterOp, string> = Object.fromEntries(
  FILTER_OPS.map((o) => [o.value, o.label]),
) as Record<FilterOp, string>;

/** A single Filter dropdown with two modes:
 *  - "UI": pick a column (which drives the operators + value input by type)
 *  - "SQL": write a raw WHERE clause yourself
 * Active filters are listed inside the popover. Values are bound as parameters
 * in UI mode; the SQL mode is passed through verbatim. */
export function FilterBar({
  columns,
  distinct,
  filters,
  custom_where,
  on_add,
  on_remove,
  on_set_conjunction,
  on_clear,
  on_custom_where,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"ui" | "sql">(() =>
    custom_where.trim() ? "sql" : "ui",
  );
  const [column, setColumn] = useState(columns[0]?.name ?? "");
  const [op, setOp] = useState<FilterOp>("eq");
  const [value, setValue] = useState("");
  const [conjunction, setConjunction] = useState<"AND" | "OR">("AND");
  const [sqlDraft, setSqlDraft] = useState(custom_where);

  const col = columns.find((c) => c.name === column);
  const config = filterConfigFor((col?.data_type ?? "").toLowerCase());
  const needs_value = NEEDS_VALUE.includes(op);
  const distinct_values = col ? (distinct[col.name] ?? []) : [];

  const active_count = filters.length + (custom_where.trim() ? 1 : 0);

  const pick_column = (name: string) => {
    setColumn(name);
    const next = columns.find((c) => c.name === name);
    const cfg = filterConfigFor((next?.data_type ?? "").toLowerCase());
    if (!cfg.ops.includes(op)) setOp(cfg.ops[0]);
    setValue("");
  };

  const apply_ui = () => {
    if (!column) return;
    if (needs_value && value.trim() === "") return;
    on_add({ column, op, value, conjunction });
    setValue("");
  };

  const apply_sql = () => {
    on_custom_where(sqlDraft.trim());
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="bg-secondary relative h-6"
          >
            <Filter className="size-3" />
            Filter
            {active_count > 0 && (
              <span className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold">
                {active_count}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent
        className="flex w-136 max-w-[min(90vw,34rem)] flex-col gap-2 p-3"
        align="start"
      >
        {/* Mode toggle */}
        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
          <div className="flex items-center gap-2">
            <Brain className="text-muted-foreground size-4" />
            <span className="text-xs font-medium">UI mode</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="filter-mode"
              checked={mode === "sql"}
              onCheckedChange={(checked) => {
                setMode(checked ? "sql" : "ui");
                if (!checked && custom_where.trim() !== "") on_clear();
              }}
            />
            <PencilLine className="text-muted-foreground size-4" />
          </div>
        </div>

        {/* Active filter badges */}
        {filters.length > 0 && (
          <>
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
                    {NEEDS_VALUE.includes(f.op) && (
                      <span className="text-foreground/80 truncate font-normal">
                        {f.value || "NULL"}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="iconXs"
                      onClick={() => on_remove(f.id)}
                      aria-label="Remove filter"
                      className="text-muted-foreground hover:text-foreground ml-1 size-4 shrink-0 p-0 opacity-60 hover:opacity-100"
                    >
                      <X className="size-3" />
                    </Button>
                  </Badge>
                </Fragment>
              ))}
            </div>
            <Separator />
          </>
        )}
        {custom_where.trim() !== "" && mode === "sql" && (
          <>
            <div className="bg-info/10 text-info flex items-center gap-1.5 rounded-md px-2 py-1 text-xs">
              <PencilLine className="size-3.5 shrink-0" />
              <code className="truncate">{custom_where}</code>
            </div>
            <Separator />
          </>
        )}

        {mode === "ui" ? (
          <>
            <div className="flex items-center gap-2">
              {filters.length > 0 && (
                <ConjunctionToggle
                  value={conjunction}
                  onChange={setConjunction}
                />
              )}
              <Select
                value={column}
                onValueChange={(v) => pick_column(v ?? "")}
              >
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
              <Button
                size="sm"
                variant="ghost"
                disabled={active_count === 0}
                onClick={() => {
                  on_clear();
                  setSqlDraft("");
                }}
              >
                Clear all filters
              </Button>
              <Button
                size="sm"
                disabled={!column || (needs_value && value.trim() === "")}
                onClick={apply_ui}
              >
                Apply
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground text-xs">
                WHERE clause (without the WHERE keyword)
              </Label>
              <Textarea
                className="font-mono text-xs"
                rows={3}
                placeholder="e.g. age >= 18 AND name LIKE 'a%'"
                value={sqlDraft}
                onChange={(e) => setSqlDraft(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="mr-auto"
                disabled={custom_where.trim() === ""}
                onClick={() => {
                  on_custom_where("");
                  setSqlDraft("");
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={sqlDraft.trim() === ""}
                onClick={apply_sql}
              >
                Apply
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** AND/OR selector that joins one filter to the previous one. */
function ConjunctionToggle({
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
            "h-5 cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold",
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

function FilterValueInput({
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
