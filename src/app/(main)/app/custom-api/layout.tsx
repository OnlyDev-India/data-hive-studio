"use client";
import React, { useEffect, useState } from "react";
import { APISidebar } from "@/features/custom-api/components/navbar";
import ResizableLayout from "@/components/common/resizable-layout";
import { TestResultsProvider } from "@/features/custom-api/context/test-results-context";
import { WorkbenchProvider } from "@/features/custom-api/context";

const CustomApiLayout = ({ children }: { children: React.ReactNode }) => {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.electron !== "undefined"
    ) {
      setIsDesktop(true);
    }
  }, []);
  return isDesktop ? (
    <WorkbenchProvider>
      <TestResultsProvider>
        <ResizableLayout child1={<APISidebar />} child2={children} />
      </TestResultsProvider>
    </WorkbenchProvider>
  ) : (
    <div className="h-full w-full flex-1 rounded-lg bg-secondary p-2 pl-0">
      <div className="flex h-full w-full items-center justify-center">
        Available on desktop only
      </div>
    </div>
  );
};

export default CustomApiLayout;
