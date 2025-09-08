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
import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";

type direction = "horizontal" | "vertical";

interface ResizableLayoutProps {
  child1: React.ReactNode;
  child2: React.ReactNode;
  activeId?: string;
  config?: keyof typeof resizableConfig;
  direction?: direction;
  collapsible?: boolean;
  isSidebar?: boolean;
  separatorVariant?: "noSeparatorHorizontal" | "noSeparatorVertical";
  isSubLayout?: boolean;
}

const dividerClass = cva("bg-background", {
  variants: {
    direction: {
      horizontal: "!w-1",
      vertical: "!h-1",
    },
    variant: {
      noSeparatorHorizontal: "!w-[1px] bg-border",
      noSeparatorVertical: "!h-[1px] bg-border",
    },
  },
});

const panelClass = cva("rounded-lg overflow-hidden", {
  variants: {
    direction: {
      horizontal: "py-2",
      vertical: "p-0 bg-secondary",
      subLayoutVertical: "p-0",
    },
  },
});

const ResizableLayout = ({
  child1,
  child2,
  activeId,
  config = "default",
  direction = "horizontal",
  collapsible = true,
  isSidebar = true,
  separatorVariant,
  isSubLayout = false,
}: ResizableLayoutProps) => {
  const currentActiveId = activeId || "editor-sidebar";
  const { getResizableState, toggleResizable, handleResizeCollapse } =
    useResizable();
  const ref = useRef<ImperativePanelHandle>(null);
  const resizableState = getResizableState(currentActiveId);
  const { defaultSizes, minSizes, maxSizes } = resizableConfig[config];
  const [isFirstRender, setIsFirstRender] = useState(true);

  useEffect(() => {
    if (isFirstRender) {
      setIsFirstRender(false);
      if (!isSubLayout) {
        toggleResizable(currentActiveId, "expanded");
      }
      return;
    }
    if (child2 && resizableState.state === "expanded" && ref.current) {
      ref.current.resize(resizableState.size?.[0] || defaultSizes[0]);
    } else if (child2 && resizableState.state === "collapsed" && ref.current) {
      ref.current.resize(resizableState.size?.[0] || 0);
    }
  }, [resizableState, ref, child2]);
  return (
    <ResizablePanelGroup direction={direction} autoSaveId={currentActiveId}>
      <ResizablePanel
        ref={ref}
        defaultSize={defaultSizes[0]}
        minSize={minSizes[0]}
        maxSize={maxSizes[0]}
        className={cn(panelClass({ direction: isSubLayout ? "subLayoutVertical" : direction}))}
        onCollapse={() => handleResizeCollapse(true, currentActiveId)}
        onExpand={() => handleResizeCollapse(false, currentActiveId)}
        collapsible={collapsible}
        order={1}
      >
        {isSidebar ? <SubSideBar>{child1}</SubSideBar> : child1}
      </ResizablePanel>
      <ResizableHandle
        className={cn(dividerClass({ direction, variant: separatorVariant }))}
      />
      {child2 && (
        <ResizablePanel
          defaultSize={defaultSizes[1]}
          minSize={minSizes[1]}
          maxSize={maxSizes[1]}
          className={cn("p-2 pl-0", {
            "bg-background p-0": direction === "vertical" || isSubLayout,
          })}
          order={2}
        >
          <div className="h-full overflow-hidden rounded-lg bg-secondary">
            {child2}
          </div>
        </ResizablePanel>
      )}
    </ResizablePanelGroup>
  );
};

export default ResizableLayout;
