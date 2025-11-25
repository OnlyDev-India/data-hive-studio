import React, { Suspense } from "react";
import ResizableLayout from "@/components/common/resizable-layout";
import SubSideBars from "@/components/navbar/sub-sidebar-editors";
import Loader from "@/components/common/loader";

const EditorLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <Suspense fallback={<Loader />}>
      <ResizableLayout
        child1={
          <Suspense fallback={<></>}>
            <SubSideBars />
          </Suspense>
        }
        child2={children}
        hasSubLayout
      />
    </Suspense>
  );
};

export default EditorLayout;
