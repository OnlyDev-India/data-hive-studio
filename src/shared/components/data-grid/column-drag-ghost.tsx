import { createPortal } from "react-dom";
import { useGrid } from "./grid-context";

/** Floating chip that follows the pointer while a column header is being
 *  dragged — same pattern as the workspace tab bar's own `DragGhost`
 *  (`features/workspace/components/drag-ghost.tsx`), just reading the drag
 *  position from the grid's own context instead of the global store.
 *  Rendered once per grid (`grid-body.tsx`), not once per header cell. */
export function ColumnDragGhost() {
  const ctx = useGrid();
  if (!ctx.col_drag) return null;
  const { col, x, y } = ctx.col_drag;
  return createPortal(
    <div
      className="bg-popover text-foreground pointer-events-none fixed z-50 flex max-w-56 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm whitespace-nowrap shadow-lg"
      style={{ left: x, top: y }}
    >
      <span className="truncate">{col}</span>
    </div>,
    document.body,
  );
}
