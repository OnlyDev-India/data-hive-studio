import {
  useDefaultLayout,
  usePanelRef,
  type LayoutStorage,
  type PanelSize,
} from "react-resizable-panels";
import { useStudioStore } from "../store";
import { useEffect } from "react";

export function useBottomPanelSize({
  id,
  onlySaveAfterUserInteractions = true,
  panelIds,
  storage,
}: {
  id: string;
  onlySaveAfterUserInteractions?: boolean | undefined;
  panelIds: string[];
  storage: LayoutStorage;
}) {
  const panelRef = usePanelRef();

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    onlySaveAfterUserInteractions,
    panelIds,
    storage,
  });

  const bottomPanelOpen = useStudioStore((s) => s.bottomPanelOpen);
  const setBottomPanelOpen = useStudioStore((s) => s.setBottomPanelOpen);
  const onResize = (size: PanelSize) => {
    if (size.asPercentage === 0) setBottomPanelOpen(false);
    else if (size.asPercentage > 0 && !bottomPanelOpen)
      setBottomPanelOpen(true);
  };

  useEffect(() => {
    console.log(panelRef?.current?.getSize());
    if (!panelRef || !panelRef.current) return;
    const panelRefCurr = panelRef.current;
    panelRefCurr.collapse();
  }, [panelRef]);

  useEffect(() => {
    if (!panelRef || !panelRef.current) return;
    const panelRefCurr = panelRef.current;
    if (bottomPanelOpen) {
      panelRefCurr.expand();
      if (panelRefCurr.getSize().asPercentage <= 15) {
        panelRefCurr.resize("60%");
      }
    } else {
      panelRefCurr.collapse();
    }
  }, [bottomPanelOpen, panelRef]);

  return {
    panelRef,
    defaultLayout,
    onLayoutChanged,
    onResize,
    bottomPanelOpen,
  };
}
