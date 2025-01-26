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
      <ResizablePanel defaultSize={20} minSize={20} maxSize={30} className="py-2">
        <SubSideBar />
      </ResizablePanel>
      <ResizableHandle className="!w-2 bg-background" />
      <ResizablePanel defaultSize={80} minSize={50} maxSize={100} className="p-2 pl-0">
        <div className="h-full w-full flex-1">{children}</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};

export default EditorLayout;
