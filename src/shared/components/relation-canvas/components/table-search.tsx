import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { GraphTable, SchemaGraph } from "@/shared/api/types";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { searchTables } from "../lib/graph";

const MAX_RESULTS = 8;

/** Find a table by name; picking one centers and selects it. */
export function TableSearch({
  graph,
  onPick,
  placeholder = "Find table…",
  className,
  disabled = false,
}: {
  graph: SchemaGraph;
  onPick: (t: GraphTable) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const list = useId();
  const results = useMemo(
    () => searchTables(graph, q).slice(0, MAX_RESULTS),
    [graph, q],
  );

  const pick = (t: GraphTable | undefined) => {
    if (!t) return;
    onPick(t);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive(
        (a) => (a + step + results.length) % Math.max(results.length, 1),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      if (open && q) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const expanded = open && q.trim().length > 0;
  return (
    <div className={cn("relative w-48", className)}>
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
      <Input
        role="combobox"
        aria-expanded={expanded}
        aria-controls={list}
        aria-autocomplete="list"
        aria-label="Find a table in the diagram"
        aria-activedescendant={
          expanded && results[active] ? `${list}-${active}` : undefined
        }
        className="text-small h-7 pr-2 pl-7"
        placeholder={placeholder}
        disabled={disabled}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {expanded && (
        <ul
          id={list}
          role="listbox"
          className="bg-popover text-popover-foreground ring-foreground/10 rounded-surface absolute top-full right-0 left-0 z-30 mt-1 max-h-64 overflow-y-auto p-1 shadow-md ring-1"
        >
          {results.length === 0 ? (
            <li className="text-muted-foreground text-small px-2 py-1.5">
              No matching table
            </li>
          ) : (
            results.map((t, i) => (
              <li
                key={`${t.schema ?? ""}.${t.name}.${t.stub}`}
                id={`${list}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  "rounded-inset text-small flex cursor-pointer items-center gap-2 px-2 py-1.5",
                  i === active && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {t.stub && t.schema && (
                  <span className="text-muted-foreground text-caption">
                    {t.schema}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
