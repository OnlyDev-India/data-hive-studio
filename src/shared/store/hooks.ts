import type { ConnectionInfo } from "../api/types";
import { useStudioStore } from "./store";
import { tabKey } from "./tab-utils";
import type { WorkspaceTabs } from "./types";
import { DEFAULT_WORKSPACE } from "./workspace";

/** The workspace (tabs) for a connection. Stable default until the first action. */
export function useWorkspace(connId: string): WorkspaceTabs {
  return useStudioStore((s) => s.workspaces[connId] ?? DEFAULT_WORKSPACE);
}

/** The visible data/schema mode of a table pane (keyed by tab instance). */
export function usePaneMode(connId: string, tabKey: string): "data" | "schema" {
  return useStudioStore(
    (s) => s.workspaces[connId]?.paneModes[tabKey] ?? "data",
  );
}

/** The id of the connection whose workspace is on screen, if any. */
export function useActiveConnectionId(): string | null {
  return useStudioStore((s) => s.activeId);
}

/** The connection currently on screen, falling back to the first open one. */
export function useActiveConnection(): ConnectionInfo | null {
  const open = useStudioStore((s) => s.open);
  const activeId = useStudioStore((s) => s.activeId);
  if (activeId) {
    const found = open.find((c) => c.id === activeId);
    if (found) return found;
  }
  return open[0] ?? null;
}

/** Whether the currently ACTIVE tab's bottom panel is open — the title
 *  bar's toggle button and the native "Toggle Bottom Panel" menu command
 *  read this so their icon/tooltip reflect that tab's own state, not any
 *  other open tab's. `false` when there's no active tab (no connection
 *  open, or its focused pane has none). */
export function useActiveBottomPanelOpen(): boolean {
  return useStudioStore((s) => {
    const active = s.activeId
      ? (s.workspaces[s.activeId]?.active ?? null)
      : null;
    return active
      ? (s.bottomPanelOpen[`${s.activeId}\u0000${tabKey(active)}`] ?? false)
      : false;
  });
}
