import type { ReactNode } from "react";
import { Panel } from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";
import type { GraphTable, SchemaGraph } from "@/shared/api/types";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import type { ColumnMode } from "../lib/graph";
import { TableSearch } from "./table-search";

const MODES: { value: ColumnMode; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Every column" },
  { value: "keys", label: "Keys", hint: "Primary and foreign key columns" },
  { value: "names", label: "Names", hint: "Table names only" },
];

// `m-2!` beats React Flow's own 15px panel margin.
const CARD = "bg-popover rounded-control m-2! border p-0.5 shadow-xs";

/** Which columns every box lists. */
export function ColumnToggle({
  mode,
  onMode,
  disabled = false,
}: {
  mode: ColumnMode;
  onMode: (m: ColumnMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Columns shown"
      className="bg-muted rounded-control flex items-center p-0.5"
    >
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={mode === m.value}
          disabled={disabled}
          title={m.hint}
          onClick={() => onMode(m.value)}
          className={cn(
            "rounded-inset text-small focus-visible:ring-ring/50 h-6 px-2 outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
            mode === m.value
              ? "bg-background text-foreground font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** The column toggle and search (top left) and the zoom stack (bottom left),
 *  floating on the canvas. React Flow panels sit outside the viewport, so
 *  they never pan or zoom it and never show in an export. */
export function CanvasControls({
  mode,
  onMode,
  graph,
  onPick,
  onZoomIn,
  onZoomOut,
  onFit,
  end,
  disabled,
}: {
  mode: ColumnMode;
  onMode: (m: ColumnMode) => void;
  graph: SchemaGraph;
  onPick: (t: GraphTable) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Host controls after the search box, such as the inferred links switch. */
  end?: ReactNode;
  /** Nothing drawn: the controls stay on screen but can't be used. */
  disabled: boolean;
}) {
  const zoom = [
    { label: "Zoom in", icon: Plus, onClick: onZoomIn },
    { label: "Zoom out", icon: Minus, onClick: onZoomOut },
    { label: "Fit to screen", icon: Maximize, onClick: onFit },
  ];
  return (
    <>
      <Panel
        position="top-left"
        role="group"
        aria-label={end ? "Columns, search and links" : "Columns and search"}
        // Wraps before it reaches the top right "Laying out…" badge.
        className={cn(
          CARD,
          "flex max-w-[calc(100%-7.5rem)] flex-wrap items-center gap-1.5",
        )}
      >
        <ColumnToggle mode={mode} onMode={onMode} disabled={disabled} />
        <TableSearch graph={graph} onPick={onPick} disabled={disabled} />
        {end}
      </Panel>
      <Panel
        position="bottom-left"
        role="group"
        aria-label="Zoom"
        className={cn(CARD, "flex flex-col")}
      >
        {zoom.map(({ label, icon: Icon, onClick }) => (
          <Button
            key={label}
            size="iconXs"
            variant="ghost"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
          >
            <Icon className="size-3.5" />
          </Button>
        ))}
      </Panel>
    </>
  );
}
