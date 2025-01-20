"use client";
import React, { useEffect } from "react";
import { Provider } from "react-redux";
import store from "@/redux/store";
import { useTheme } from "next-themes";

const ReduxProvider = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useTheme();

  useEffect(() => {
    window?.electron?.updateTheme?.(theme || "");
  }, [theme]);

  return <Provider store={store}>{children}</Provider>;
};

export default ReduxProvider;
