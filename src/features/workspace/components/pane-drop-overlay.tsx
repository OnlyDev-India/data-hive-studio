import { useStudioStore } from "@/shared/store";
import { cn } from "@/shared/lib/utils";

/** Presentational only — highlights the edge (split) or full-pane (plain
 *  move) a drag is currently hovering over, for pane `paneId`. Reads
 *  `dropTarget` from the store; writes nothing itself. */
export function PaneDropOverlay({ paneId }: { paneId: string }) {
  const dropTarget = useStudioStore((s) => s.dropTarget);
  if (!dropTarget || dropTarget.paneId !== paneId) return null;
  const { edge } = dropTarget;
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div
        className={cn(
          "bg-primary/20 border-primary absolute border-2",
          edge === "left" && "inset-y-0 left-0 w-1/2 border-r",
          edge === "right" && "inset-y-0 right-0 w-1/2 border-l",
          edge === "top" && "inset-x-0 top-0 h-1/2 border-b",
          edge === "bottom" && "inset-x-0 bottom-0 h-1/2 border-t",
          edge === "center" && "inset-0",
        )}
      />
    </div>
  );
}
