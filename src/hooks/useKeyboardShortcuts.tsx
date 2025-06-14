import { useEffect } from "react";

type ShortcutCallback = (event: KeyboardEvent) => void;

interface ShortcutConfig {
  keys: string[]; // List of key combinations
  action: ShortcutCallback; // Action to execute
}

export const useKeyboardShortcuts = (shortcuts: ShortcutConfig[]) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      shortcuts.forEach(({ keys, action }) => {
        const metaKey = event.metaKey || event.ctrlKey;
        // Safely handle event.key
        const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
        const pressedKeyCombo = `${metaKey ? "Ctrl+" : ""}${
          event.altKey ? "Alt+" : ""
        }${event.shiftKey ? "Shift+" : ""}${key}`;

        // Also check cmd variations for Mac compatibility
        const cmdKeyCombo = `${event.metaKey ? "cmd+" : ""}${event.ctrlKey ? "ctrl+" : ""}${
          event.altKey ? "alt+" : ""
        }${event.shiftKey ? "shift+" : ""}${key}`;

        if (keys.some(keyCombo => 
          keyCombo.toLowerCase() === pressedKeyCombo || 
          keyCombo.toLowerCase() === cmdKeyCombo
        )) {
          event.preventDefault();
          action(event);
        }
      });
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shortcuts]);
};
