import { Crosshair, X } from "lucide-react";
import type { GraphTable, SchemaGraph } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import { tableId, TableSearch } from "@/shared/components/relation-canvas";
import { cn } from "@/shared/lib/utils";

export interface FocusState {
  /** Table id, or null while a big schema waits for a pick. */
  table: string | null;
  hops: number;
}

/** Focus mode: one table plus its neighbors 1, 2 or 3 links away. */
export function FocusControls({
  graph,
  focus,
  focusName,
  onChange,
  disabled = false,
}: {
  graph: SchemaGraph;
  focus: FocusState | null;
  focusName: string | null;
  onChange: (f: FocusState | null) => void;
  disabled?: boolean;
}) {
  if (!focus)
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => onChange({ table: null, hops: 1 })}
        title="Show one table and its neighbors"
      >
        <Crosshair className="size-3.5" />
        Focus
      </Button>
    );
  const pick = (t: GraphTable) => onChange({ ...focus, table: tableId(t) });
  return (
    <div className="bg-muted/60 rounded-control flex items-center gap-1.5 py-0.5 pr-0.5 pl-2">
      <Crosshair className="text-primary size-3.5 shrink-0" aria-hidden />
      <span className="text-small text-muted-foreground">Focus</span>
      <TableSearch
        graph={graph}
        onPick={pick}
        placeholder={focusName ?? "Pick a table…"}
        className="w-40"
        disabled={disabled}
      />
      <div role="radiogroup" aria-label="Hops" className="flex items-center">
        {[1, 2, 3].map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={focus.hops === h}
            aria-label={`${h} ${h === 1 ? "hop" : "hops"}`}
            title={`Neighbors up to ${h} ${h === 1 ? "link" : "links"} away`}
            onClick={() => onChange({ ...focus, hops: h })}
            className={cn(
              "rounded-inset text-small focus-visible:ring-ring/50 h-6 w-6 outline-none focus-visible:ring-2",
              focus.hops === h
                ? "bg-background text-foreground font-medium shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {h}
          </button>
        ))}
      </div>
      <Button
        size="iconXs"
        variant="ghost"
        onClick={() => onChange(null)}
        aria-label="Leave focus mode and show every table"
        title="Show every table"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
