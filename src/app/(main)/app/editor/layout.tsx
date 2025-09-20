import React, { Suspense } from "react";
import ResizableLayout from "@/components/common/resizable-layout";
import SubSideBars from "@/components/navbar/sub-sidebar-editors";

const EditorLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Suspense fallback={<></>}>
      <ResizableLayout
        child1={
          <Suspense fallback={<></>}>
            <SubSideBars />
          </Suspense>
        }
        child2={children}
      />
    </Suspense>
  );
};

export default EditorLayout;
