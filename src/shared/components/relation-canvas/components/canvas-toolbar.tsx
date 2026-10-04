import type { ReactNode, RefObject } from "react";
import { Download, Loader2 } from "lucide-react";
import { usePaneCompactWidth } from "@/shared/hooks/use-pane-compact-width";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import type { ExportFormat } from "../lib/export";
import {
  CANVAS_SHRINK_SLOTS,
  CanvasButton,
  CanvasCompact,
} from "./canvas-button";

const PANE_COMPACT_BELOW_PX = 380;
const ONE_BUTTON_MIN_SHRINK = 40;

export function CanvasToolbar({
  paneRef,
  start,
  startPx = 0,
  end,
  bare = false,
  onExport,
  exporting,
  canExport,
  disabled,
}: {
  /** The pane whose width decides the compact layout, never the toolbar
   *  itself, since collapsing it would shrink what gets measured. */
  paneRef: RefObject<HTMLElement | null>;
  start?: ReactNode;
  /** About how wide `start` is, so labels collapse before the row wraps. */
  startPx?: number;
  end?: ReactNode;
  /** No background, border or padding: it sits inside the pane header. */
  bare?: boolean;
  onExport: (f: ExportFormat) => void;
  exporting: boolean;
  canExport: boolean;
  /** No graph yet: the controls stay in place but can't be used. */
  disabled: boolean;
}) {
  const compact = usePaneCompactWidth(
    paneRef,
    CANVAS_SHRINK_SLOTS,
    PANE_COMPACT_BELOW_PX + startPx,
    ONE_BUTTON_MIN_SHRINK,
  );
  return (
    <CanvasCompact value={compact}>
      <div
        role="toolbar"
        aria-label="Diagram"
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2",
          bare
            ? "flex-1"
            : "bg-editor-toolbar shrink-0 border-b px-3 py-1.5",
        )}
      >
        {start}
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
      </div>
    </CanvasCompact>
  );
}
