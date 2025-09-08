"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

type ResizablePanels = {
  saveId: string;
  state: "expanded" | "collapsed";
  size?: [number, number];
};

interface ResizableContextType {
  resizablePanels: ResizablePanels[];
  toggleResizable: (
    saveId: string,
    state?: "expanded" | "collapsed",
    size?: [number, number],
  ) => void;
  getResizableState: (saveId: string) => ResizablePanels;
  handleResizeCollapse: (collapsed: boolean, saveId: string) => void;
}

const ResizableContext = createContext<ResizableContextType | undefined>(
  undefined,
);

interface ResizableProviderProps {
  children: ReactNode;
}

export const ResizableProvider: React.FC<ResizableProviderProps> = ({
  children,
}) => {
  const [resizablePanels, setResizablePanels] = useState<ResizablePanels[]>([]);

  const toggleResizable = (
    saveId: string,
    state?: "expanded" | "collapsed",
    size?: [number, number],
  ) => {
    setResizablePanels((prev: ResizablePanels[]) => {
      const newResizablePanels = prev.find((panel) => panel.saveId === saveId)
        ? prev.map((panel) =>
            panel.saveId === saveId
              ? {
                  saveId: saveId,
                  state: state
                    ? state
                    : panel.state === "expanded"
                      ? ("collapsed" as const)
                      : ("expanded" as const),
                  size: size ? size : panel.size,
                }
              : panel,
          )
        : [...prev, { saveId: saveId, state: "expanded" as const, size: size }];

      // Save to localStorage with the new state
      localStorage.setItem(
        "resizablePanels",
        JSON.stringify(newResizablePanels),
      );
      return newResizablePanels;
    });
  };

  const getResizableState = (saveId: string): ResizablePanels => {
    const panel = resizablePanels.find((panel) => panel.saveId === saveId);
    return panel ? panel : { saveId: saveId, state: "expanded" as const }; // Default to expanded
  };

  const handleResizeCollapse = (collapsed: boolean, saveId: string) => {
    const state = collapsed ? "collapsed" : "expanded";
    toggleResizable(saveId, state);
  };

  useEffect(() => {
    const savedResizablePanels = localStorage.getItem("resizablePanels");
    if (savedResizablePanels) {
      setResizablePanels(JSON.parse(savedResizablePanels));
    }
  }, []);

  const value: ResizableContextType = {
    resizablePanels,
    toggleResizable,
    getResizableState,
    handleResizeCollapse,
  };

  return (
    <ResizableContext.Provider value={value}>
      {children}
    </ResizableContext.Provider>
  );
};

export const useResizable = (): ResizableContextType => {
  const context = useContext(ResizableContext);
  if (context === undefined) {
    throw new Error("useResizable must be used within a ResizableProvider");
  }
  return context;
};
