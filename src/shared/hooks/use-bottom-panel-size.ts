import {
  useDefaultLayout,
  usePanelRef,
  type Layout,
  type LayoutChangedMeta,
  type LayoutStorage,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { useStudioStore } from "../store";
import { useCallback, useEffect, useRef, useState } from "react";

/** Size (percent) the bottom panel opens at when its tab starts out open. */
const OPEN_DEFAULT_SIZE = 25;

/** Push the store's open/closed state onto the panel. Acts only on a
 *  mismatch, so it never fights a panel the user has already dragged to the
 *  state the store is about to record. */
function syncPanel(panel: PanelImperativeHandle, open: boolean) {
  if (open) {
    if (!panel.isCollapsed()) return;
    panel.expand();
    if (panel.getSize().asPercentage <= 15) panel.resize("60%");
  } else if (!panel.isCollapsed()) {
    panel.collapse();
  }
}

export function useBottomPanelSize({
  conn_id,
  tab_key,
  onlySaveAfterUserInteractions = true,
  panelIds,
  storage,
}: {
  conn_id: string;
  tab_key: string;
  onlySaveAfterUserInteractions?: boolean | undefined;
  panelIds: string[];
  storage: LayoutStorage;
}) {
  const panelRef = usePanelRef();
  // Same composite key `jsonRows` uses, so this tab's size and open/closed
  // state never collide with a same-shaped tab in a different connection.
  const scope = `${conn_id}\u0000${tab_key}`;

  const { defaultLayout, onLayoutChanged: saveLayout } = useDefaultLayout({
    id: scope,
    onlySaveAfterUserInteractions,
    panelIds,
    storage,
  });

  const bottomPanelOpen = useStudioStore(
    (s) => s.bottomPanelOpen[scope] ?? false,
  );
  const setBottomPanelOpenFor = useStudioStore((s) => s.setBottomPanelOpenFor);
  // For a tab that wants its own panel shown (a query editor when a run
  // starts) rather than the user toggling it.
  const openBottomPanel = useCallback(
    () => setBottomPanelOpenFor(scope, true),
    [setBottomPanelOpenFor, scope],
  );

  // The size the panel falls back to when its group has no measurable size at
  // registration (a tab's portal slot still hidden or detached): the library
  // then discards any layout applied before that and uses the panels' own
  // default sizes once it gets one, which would silently reopen a panel this
  // tab has closed. Frozen at first render because changing a panel's
  // `defaultSize` re-registers it.
  const [defaultSize] = useState(bottomPanelOpen ? OPEN_DEFAULT_SIZE : 0);

  // The store is the single source of truth for open/closed. Only a change
  // the user made (releasing a drag or a keyboard resize on the handle) is
  // mirrored INTO it; anything else the library reports (initial layout, a
  // reset, a window resize) is pushed back the other way. Inferring "the user
  // opened it" from a panel's size (`Panel.onResize`) instead raced with the
  // initial layout: whenever the browser reported the panel's default size
  // before the collapse below ran, the store flipped to open and stayed there.
  const onLayoutChanged = (layout: Layout, meta: LayoutChangedMeta) => {
    saveLayout(layout, meta);
    const panel = panelRef.current;
    if (!panel) return;
    const stored = useStudioStore.getState().bottomPanelOpen[scope] ?? false;
    if (meta.isUserInteraction) {
      const open = !panel.isCollapsed();
      if (open !== stored) setBottomPanelOpenFor(scope, open);
      return;
    }
    syncPanel(panel, stored);
  };

  // The table/collection panes only mount their panel group once the schema
  // has loaded, so `panelRef.current` is still null on this hook's first
  // effect run. Running with no deps array and remembering what was applied to
  // which panel means the state is pushed onto the panel the render it
  // actually appears (and again if it remounts), instead of being skipped for
  // good and leaving a closed tab's panel sitting open at its default size.
  const applied = useRef<{
    panel: PanelImperativeHandle;
    open: boolean;
  } | null>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      applied.current = null;
      return;
    }
    const last = applied.current;
    if (last && last.panel === panel && last.open === bottomPanelOpen) return;
    applied.current = { panel, open: bottomPanelOpen };
    syncPanel(panel, bottomPanelOpen);
  });

  return {
    panelRef,
    defaultLayout,
    defaultSize,
    onLayoutChanged,
    bottomPanelOpen,
    openBottomPanel,
  };
}
