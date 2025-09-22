"use client";
import React, { useEffect, useRef, useState } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import SubSideBar from "@/components/navbar/sub-sidebar-layout";
import { useResizable } from "@/providers/resizable-provider";
import { ImperativePanelHandle } from "react-resizable-panels";
import resizableConfig from "@/config/resizableConfig";
import { cn } from "@/lib/utils";
import { cva } from "class-variance-authority";
import { useSearchParams } from "next/navigation";

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
  hasSubLayout?: boolean;
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
  hasSubLayout = false,
}: ResizableLayoutProps) => {
  const currentActiveId = activeId || "editor-sidebar";
  const { getResizableState, toggleResizable, handleResizeCollapse } =
    useResizable();
  const ref1 = useRef<ImperativePanelHandle>(null);
  const ref2 = useRef<ImperativePanelHandle>(null);
  const resizableState = getResizableState(currentActiveId);
  const { defaultSizes, minSizes, maxSizes, collapsedTo } =
    resizableConfig[config];
  const searchParams = useSearchParams();
  const sidebar = searchParams.get("sidebar");

  useEffect(() => {
    // if (!isSubLayout) {
    toggleResizable(currentActiveId, "expanded");
    // }
  }, [sidebar]);

  useEffect(() => {
    if (!child2 || !ref1.current || !ref2.current) {
      return;
    }
    const isExpandedChild1 = ref1.current.isExpanded();
    const isCollapsedChild1 = ref1.current.isCollapsed();
    const isToBeExpandedChild1 =
      resizableState.state === "expanded" && isCollapsedChild1;
    const isToBeCollapsedChild1 =
      resizableState.state === "collapsed" && isExpandedChild1;
    if (isToBeExpandedChild1) {
      ref1.current.expand();
      return;
    } else if (isToBeCollapsedChild1) {
      ref1.current.collapse();
      return;
    }

    const isExpandedChild2 = ref2.current.isExpanded();
    const isCollapsedChild2 = ref2.current.isCollapsed();
    const isToBeExpandedChild2 =
      resizableState.state === "expanded:2" && isCollapsedChild2;
    const isToBeCollapsedChild2 =
      resizableState.state === "collapsed:2" && isExpandedChild2;
    if (isToBeExpandedChild2) {
      ref2.current.expand();
      return;
    } else if (isToBeCollapsedChild2) {
      ref2.current.collapse();
      return;
    }
  }, [resizableState, ref1, child2, ref2]);

  return (
    <ResizablePanelGroup direction={direction} autoSaveId={currentActiveId}>
      <ResizablePanel
        ref={ref1}
        defaultSize={defaultSizes[0]}
        minSize={minSizes[0]}
        maxSize={maxSizes[0]}
        className={cn(
          panelClass({
            direction,
          }),
        )}
        onCollapse={() => handleResizeCollapse(currentActiveId, "collapsed")}
        onExpand={() => handleResizeCollapse(currentActiveId, "expanded")}
        collapsible={collapsible}
        collapsedSize={collapsedTo ? collapsedTo[0] : 0}
        order={1}
      >
        {isSidebar ? <SubSideBar>{child1}</SubSideBar> : child1}
      </ResizablePanel>
      {child2 && (
        <>
          <ResizableHandle
            className={cn(
              dividerClass({ direction, variant: separatorVariant }),
            )}
          />
          <ResizablePanel
            ref={ref2}
            defaultSize={defaultSizes[1]}
            minSize={minSizes[1]}
            maxSize={maxSizes[1]}
            className={cn("p-2 pl-0", {
              "p-0": direction === "vertical",
            })}
            order={2}
            onCollapse={() =>
              handleResizeCollapse(currentActiveId, "collapsed:2")
            }
            onExpand={() => handleResizeCollapse(currentActiveId, "expanded:2")}
            collapsedSize={collapsedTo ? collapsedTo[1] : 0}
            collapsible={collapsible}
          >
            <div
              className={cn("h-full overflow-hidden rounded-lg bg-secondary", {
                "bg-background": direction === "vertical" || hasSubLayout,
              })}
            >
              {child2}
            </div>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
};

export default ResizableLayout;
