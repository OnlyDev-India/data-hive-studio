import type { ReactNode, RefObject } from "react";
import { Download, Loader2, Maximize, Minus, Plus } from "lucide-react";
import type { GraphTable, SchemaGraph } from "@/shared/api/types";
import { usePaneCompactWidth } from "@/shared/hooks/use-pane-compact-width";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { ColumnMode } from "../lib/graph";
import type { ExportFormat } from "../lib/export";
import { TableSearch } from "./table-search";
import {
  CANVAS_SHRINK_SLOTS,
  CanvasButton,
  CanvasCompact,
} from "./canvas-button";

const PANE_COMPACT_BELOW_PX = 780;
/** The extra width `start` takes when it shares the control row. */
const INLINE_START_PX = 120;
const ONE_BUTTON_MIN_SHRINK = 40;

const MODES: { value: ColumnMode; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Every column" },
  { value: "keys", label: "Keys", hint: "Primary and foreign key columns" },
  { value: "names", label: "Names", hint: "Table names only" },
];

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

export function CanvasToolbar({
  paneRef,
  start,
  inline = false,
  end,
  mode,
  onMode,
  graph,
  onPick,
  onZoomIn,
  onZoomOut,
  onFit,
  onExport,
  exporting,
  canExport,
  disabled,
}: {
  /** The pane whose width decides the compact layout, never the toolbar
   *  itself, since collapsing it would shrink what gets measured. */
  paneRef: RefObject<HTMLElement | null>;
  start?: ReactNode;
  /** Put `start` at the head of the control row instead of a row above. */
  inline?: boolean;
  end?: ReactNode;
  mode: ColumnMode;
  onMode: (m: ColumnMode) => void;
  graph: SchemaGraph;
  onPick: (t: GraphTable) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onExport: (f: ExportFormat) => void;
  exporting: boolean;
  canExport: boolean;
  /** No graph yet: the controls stay in place but can't be used. */
  disabled: boolean;
}) {
  const compact = usePaneCompactWidth(
    paneRef,
    CANVAS_SHRINK_SLOTS,
    PANE_COMPACT_BELOW_PX + (inline ? INLINE_START_PX : 0),
    ONE_BUTTON_MIN_SHRINK,
  );
  const controls = (
    <>
      <ColumnToggle mode={mode} onMode={onMode} disabled={disabled} />
      <TableSearch graph={graph} onPick={onPick} disabled={disabled} />
      <div className="flex items-center">
        <Button
          size="iconXs"
          variant="ghost"
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus className="size-3.5" />
        </Button>
        <Button
          size="iconXs"
          variant="ghost"
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          size="iconXs"
          variant="ghost"
          onClick={onFit}
          aria-label="Fit to screen"
          title="Fit to screen"
        >
          <Maximize className="size-3.5" />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {end}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <CanvasButton
                variant="outline"
                disabled={disabled || !canExport || exporting}
                label="Export"
                shrink={2}
                icon={
                  exporting ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Download className="size-3.5" />
                  )
                }
              />
            }
          />
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => onExport("png")}>
              PNG image
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("svg")}>
              SVG image
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
  return (
    <CanvasCompact value={compact}>
      <div
        role="toolbar"
        aria-label="Diagram"
        className="bg-editor-toolbar flex flex-col gap-1.5 border-b px-3 py-1.5"
      >
        {start != null && !inline && (
          <div className="flex flex-wrap items-center gap-2">{start}</div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {inline && start}
          {controls}
        </div>
      </div>
    </CanvasCompact>
  );
}
