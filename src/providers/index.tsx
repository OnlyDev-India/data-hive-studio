"use client";
import React from "react";
import ReduxProvider from "./redux-provider";
import { ReactFlowProvider } from "@xyflow/react";
import ShortCutProvider from "./shortcut-provider";
import { ThemeProvider } from "next-themes";
import { ResizableProvider } from "./resizable-provider";

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <ReduxProvider>
        <ReactFlowProvider>
          <ShortCutProvider>
            <ResizableProvider>
              {children}
            </ResizableProvider>
          </ShortCutProvider>
        </ReactFlowProvider>
      </ReduxProvider>
    </ThemeProvider>
  );
};

export default Providers;
