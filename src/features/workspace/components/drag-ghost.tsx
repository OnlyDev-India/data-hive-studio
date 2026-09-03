import { createPortal } from "react-dom";
import { TabTypeIcon } from "@/shared/components/tab-type-icon";
import { tabKey, tabLabel, useStudioStore } from "@/shared/store";

/** Floating chip that follows the pointer while a tab is being dragged.
 *  Rendered ONCE per workspace (not per TabBar/pane) — with split-view many
 *  TabBar instances can be mounted at once, and only one ghost should ever
 *  exist for a single in-flight drag. */
export function DragGhost() {
  const dragTab = useStudioStore((s) => s.dragTab);
  const dragPointer = useStudioStore((s) => s.dragPointer);
  const file_name = useStudioStore((s) =>
    dragTab ? s.sqlTabs[tabKey(dragTab.tab)]?.file_name : undefined,
  );
  if (!dragTab || !dragPointer) return null;
  return createPortal(
    <div
      className="bg-popover text-foreground pointer-events-none fixed z-50 flex max-w-56 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm whitespace-nowrap shadow-lg"
      style={{ left: dragPointer.x, top: dragPointer.y }}
    >
      <TabTypeIcon tab={dragTab.tab} />
      <span className="truncate">{tabLabel(dragTab.tab, file_name)}</span>
    </div>,
    document.body,
  );
}
