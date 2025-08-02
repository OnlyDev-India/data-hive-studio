"use client";
import React, { useEffect } from "react";
import ReduxProvider from "./redux-provider";
import { ReactFlowProvider } from "@xyflow/react";
import ShortCutProvider from "./shortcut-provider";
import { ThemeProvider } from "next-themes";
import { taskManager } from "@/lib/task-manager";

const Providers = ({ children }: { children: React.ReactNode }) => {
  useEffect(() => {
    // Initialize the task manager
    taskManager;
  }, []);

  return (
    <ThemeProvider>
      <ReduxProvider>
        <ReactFlowProvider>
          <ShortCutProvider>
            {children}
          </ShortCutProvider>
        </ReactFlowProvider>
      </ReduxProvider>
    </ThemeProvider>
  );
};

export default Providers;
