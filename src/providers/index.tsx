"use client";
import React from "react";
import ReduxProvider from "./redux-provider";
import { ReactFlowProvider } from "@xyflow/react";
import ShortCutProvider from "./shortcut-provider";
import { ThemeProvider } from "next-themes";

const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider>
      <ReduxProvider>
          <ReactFlowProvider>
            <ShortCutProvider>{children}</ShortCutProvider>
          </ReactFlowProvider>
      </ReduxProvider>
    </ThemeProvider>
  );
};

export default Providers;
