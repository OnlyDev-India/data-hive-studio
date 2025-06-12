import { ThemeProvider, useTheme } from "next-themes";
import React, { useEffect } from "react";

const ThemesProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      {children}
    </ThemeProvider>
  );
};

export default ThemesProvider;
