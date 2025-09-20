import React from "react";
import ResizableLayout from "@/components/common/resizable-layout";
import SubSideBars from "@/components/navbar/sub-sidebar-editors";

const EditorLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ResizableLayout child1={<SubSideBars />} child2={children} />
  );
};

export default EditorLayout;
