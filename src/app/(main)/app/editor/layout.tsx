import React from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import SubSideBar from "@/components/navbar/sub-sidebar";

const EditorLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={20} minSize={20} maxSize={30}>
        <SubSideBar />
      </ResizablePanel>
      <ResizableHandle className="!w-0.5 data-[resize-handle-state=drag]:bg-primary data-[resize-handle-state=hover]:bg-primary" />
      <ResizablePanel defaultSize={80} minSize={50} maxSize={100}>
        <div className="h-full w-full flex-1">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default EditorLayout;
