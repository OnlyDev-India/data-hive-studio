import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Filter } from "lucide-react";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import type { DistinctMap, GridFilter } from "./types";
import { QueryEditor } from "@/shared/components/query-editor";
import { BsonEditor } from "@/shared/components/query-editor/bson-json-editor";
import {
  FilterConditionBuilder,
  type FilterColumn,
} from "./filter-condition-builder";

export type { FilterColumn };

export interface FilterBarProps {
  columns: FilterColumn[];
  distinct: DistinctMap;
  filters: GridFilter[];
  custom_where: string;
  on_add: (filter: Omit<GridFilter, "id">) => void;
  on_remove: (id: number) => void;
  on_set_conjunction: (id: number, conjunction: "AND" | "OR") => void;
  on_clear: () => void;
  on_custom_where: (where: string) => void;
  /** MongoDB's `custom_where` is a Mongo query JSON object (the Rust adapter
   *  rejects anything else — see `mongodb.rs`'s `build_filter`), not a SQL
   *  WHERE fragment — so the raw-condition editor switches to the BSON/JSON
   *  editor instead of the SQL one. Default "sql". */
  kind?: "sql" | "mongo";
}

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
  kind = "sql",
}: FilterBarProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [textFilterOpen, setTextFilterOpen] = useState(false);
  const [sqlDraft, setSqlDraft] = useState(custom_where);

  const active_count = filters.length + (custom_where.trim() ? 1 : 0);

  const apply_sql = () => {
    on_custom_where(sqlDraft.trim());
    setFilterOpen(false);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      apply_sql();
      setTextFilterOpen(false);
    }
  };

  // BsonEditor (used for `kind === "mongo"` below) has no `onKeyDown`
  // pass-through, so Enter is disabled/applied from inside a CodeMirror
  // extension instead of the SQL editor's DOM-bubbling `onKeyDown` — a ref
  // keeps it calling the LATEST `apply_sql` (which closes over `sqlDraft`)
  // without the keymap extension itself changing identity every keystroke;
  // an unstable `extraExtensions` array would otherwise make BsonEditor
  // tear down and rebuild its whole extension set (autocompletion included)
  // on every keystroke — see this codebase's other `Ref` + `useMemo([])`
  // pairs (e.g. query-editor/index.tsx's `runAtCursor`) for the same fix.
  const applySqlRef = useRef(apply_sql);
  useEffect(() => {
    applySqlRef.current = apply_sql;
  });
  const mongoExtraExtensions = useMemo(
    () => [
      Prec.highest(
        // eslint-disable-next-line react-hooks/refs -- keymap runs at event time
        keymap.of([
          {
            key: "Enter",
            run: () => {
              applySqlRef.current();
              setTextFilterOpen(false);
              return true;
            },
          },
        ]),
      ),
    ],
    [],
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger
          render={
            <Button
              size="iconXs"
              variant="secondary"
              className={cn(
                "h-6 gap-1 font-mono text-xs",
                active_count > 0
                  ? "text-info hover:bg-info/15"
                  : "text-muted-foreground",
              )}
            >
              <Filter className="size-3" />
            </Button>
          }
        />
        <PopoverContent
          className="flex w-136 max-w-[min(90vw,34rem)] flex-col gap-2 p-3"
          align="start"
        >
          <FilterConditionBuilder
            columns={columns}
            distinct={distinct}
            filters={filters}
            on_add={on_add}
            on_remove={on_remove}
            on_set_conjunction={on_set_conjunction}
            on_clear={() => {
              on_clear();
              setSqlDraft("");
            }}
          />
        </PopoverContent>
      </Popover>
      <span className="shrink-0 font-mono text-xs text-orange-400">Where</span>
      <Popover open={textFilterOpen} onOpenChange={setTextFilterOpen}>
        <PopoverTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                "group h-6 w-full min-w-0 flex-1 cursor-text! justify-between gap-1 truncate px-2 font-mono text-xs hover:bg-transparent",
                active_count > 0 ? "text-info" : "text-muted-foreground",
              )}
            >
              <span className="flex min-w-0 flex-1 gap-1.5">
                <span
                  className={cn(
                    "hover:text-primary min-w-0 flex-1 truncate text-start",
                    {
                      "group-hover:text-muted-foreground": !sqlDraft,
                    },
                  )}
                >
                  {sqlDraft ||
                    (kind === "mongo"
                      ? 'e.g. { "status": "active" }'
                      : "e.g. age >= 18")}
                </span>
                {active_count > 0 && (
                  <span className="bg-info/15 text-info shrink-0 rounded px-1 text-[10px] font-semibold">
                    {active_count}
                  </span>
                )}
              </span>

              <ChevronDown className="size-3 shrink-0" />
            </Button>
          }
        />
        <PopoverContent
          className="bg-background flex w-(--anchor-width) -translate-y-6 flex-col gap-2 p-0.5"
          align="start"
        >
          <div className="flex flex-col gap-1.5">
            {kind === "mongo" ? (
              <BsonEditor
                value={sqlDraft}
                onChange={setSqlDraft}
                minHeight="32px"
                compact
                lineNumbers={false}
                foldable={false}
                className="rounded-md"
                extraExtensions={mongoExtraExtensions}
              />
            ) : (
              <QueryEditor
                value={sqlDraft}
                onChange={setSqlDraft}
                onRun={() => {}}
                onRunTarget={() => {}}
                lintEnabled={false}
                showLineNumber={false}
                onKeyDown={handleKeyDown}
                className="rounded-md"
                frameLayer={false}
                autoCompletion={false}
                placeholder="e.g. age >= 18 AND name LIKE 'a%'"
                disableWrapping
                disableEnter
              />
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
