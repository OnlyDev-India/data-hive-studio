import React from "react";

const shortcuts = [
  {
    keys: "Ctrl + Shift + P",
    action: "Command Palette",
  },
  {
    keys: "Ctrl + Shift + T",
    action: "Tables View",
  },
  {
    keys: "Ctrl + Shift + V",
    action: "Schema Visualizer",
  },
  {
    keys: "Ctrl + N",
    action: "New Query File",
  },
  {
    keys: "Ctrl + Enter",
    action: "Run Query",
  },
  {
    keys: "Ctrl + W",
    action: "Close Tab",
  },
  {
    keys: "Ctrl + Q",
    action: "Disconnect Database",
  },
];

const ShortcutGrid = () => {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div>
        {shortcuts.map((item, index) => {
          const keys = item.keys.split(" + ");
          return (
            <div key={index} className="mb-4 grid grid-cols-2 gap-4">
              <span className="text-sm text-muted-foreground">
                {item.action}
              </span>
              <div>
                {keys.map((key, index) => (
                  <p
                    key={index}
                    className="inline text-sm text-muted-foreground"
                  >
                    <span className="rounded-md border border-border bg-secondary p-1 px-2">
                      {key}
                    </span>
                    {index !== keys.length - 1 && <span> + </span>}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ShortcutGrid;
