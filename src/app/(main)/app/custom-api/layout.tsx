"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import SubSideBar from "@/components/navbar/sub-sidebar";
import { useResizable } from "@/providers/resizable-provider";
import { ImperativePanelHandle } from "react-resizable-panels";
import resizableConfig from "@/config/resizableConfig";

const CustomApiLayout = ({ children }: { children: React.ReactNode }) => {
  const activeId = "editor-sidebar";
  const { getResizableState, toggleResizable, handleResizeCollapse } =
    useResizable();
  const ref = useRef<ImperativePanelHandle>(null);
  const resizableState = getResizableState(activeId);
  const { defaultSizes, minSizes, maxSizes } = resizableConfig.customApi;
  const [isFirstRender, setIsFirstRender] = useState(true);

  useEffect(() => {
    if (isFirstRender) {
      setIsFirstRender(false);
      toggleResizable(activeId, "expanded");
      return;
    }
    if (resizableState === "expanded" && ref.current) {
      ref.current.resize(defaultSizes[0]);
    } else if (resizableState === "collapsed" && ref.current) {
      ref.current.resize(0);
    }
  }, [resizableState]);
  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId={activeId}>
      <ResizablePanel
        ref={ref}
        defaultSize={defaultSizes[0]}
        minSize={minSizes[0]}
        maxSize={maxSizes[0]}
        className="py-2"
        onCollapse={() => handleResizeCollapse(true, activeId)}
        onExpand={() => handleResizeCollapse(false, activeId)}
        collapsible
      >
        <SubSideBar>test</SubSideBar>
      </ResizablePanel>
      <ResizableHandle className="!w-2 bg-background" />
      <ResizablePanel
        defaultSize={defaultSizes[1]}
        minSize={minSizes[1]}
        maxSize={maxSizes[1]}
        className="p-2 pl-0"
      >
        <div className="h-full w-full flex-1">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default CustomApiLayout;
