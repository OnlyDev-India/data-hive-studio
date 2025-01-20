"use client";
import React from "react";
import ReduxProvider from "./redux-provider";
import { ReactFlowProvider } from "@xyflow/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import ShortCutProvider from "./shortcut-provider";
import { ThemeProvider } from "next-themes";

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <ReduxProvider>
        <TooltipProvider delayDuration={0}>
          <ReactFlowProvider>
            <ShortCutProvider>{children}</ShortCutProvider>
          </ReactFlowProvider>
        </TooltipProvider>
      </ReduxProvider>
    </ThemeProvider>
  );
};

export default Providers;
