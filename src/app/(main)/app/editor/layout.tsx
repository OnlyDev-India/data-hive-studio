import React from "react";
import SideBarTables from "@/components/views/sidebar-tables";
import ResizableLayout from "@/components/common/resizable-layout";

const EditorLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <ResizableLayout child1={<SideBarTables />} child2={children} />
  );
};

export default EditorLayout;
