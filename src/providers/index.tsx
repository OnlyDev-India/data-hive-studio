"use client";
import React from "react";
import ReduxProvider from "./redux-provider";
import { ReactFlowProvider } from "@xyflow/react";
import { TooltipProvider } from "@/components/ui/tooltip";

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ReduxProvider>
      <TooltipProvider>

      <ReactFlowProvider>{children}</ReactFlowProvider>
      </TooltipProvider>
    </ReduxProvider>
  );
};

export default Providers;
