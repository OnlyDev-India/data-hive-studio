"use client";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

type ResizableState = "expanded" | "collapsed" | "expanded:2" | "collapsed:2";

type ResizablePanels = {
  saveId: string;
  state: ResizableState;
};

interface ResizableContextType {
  resizablePanels: ResizablePanels[];
  toggleResizable: (
    saveId: string,
    state: ResizableState,
  ) => void;
  getResizableState: (saveId: string) => ResizablePanels;
  handleResizeCollapse: (saveId: string, state: ResizableState) => void;
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
    state: ResizableState,
  ) => {
    setResizablePanels((prev: ResizablePanels[]) => {
      const newResizablePanels = prev.find((panel) => panel.saveId === saveId)
        ? prev.map((panel) =>
            panel.saveId === saveId
              ? {
                  saveId: saveId,
                  state: state,
                }
              : panel,
          )
        : [...prev, { saveId: saveId, state: "expanded" as ResizableState }];

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

  const handleResizeCollapse = (saveId: string, state: ResizableState) => {
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
