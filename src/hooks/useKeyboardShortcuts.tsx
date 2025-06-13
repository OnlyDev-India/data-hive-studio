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
        const pressedKeyCombo = `${metaKey ? "Ctrl+" : ""}${
          event.altKey ? "Alt+" : ""
        }${event.shiftKey ? "Shift+" : ""}${event.key.toLowerCase()}`;

        // Also check cmd variations for Mac compatibility
        const cmdKeyCombo = `${event.metaKey ? "cmd+" : ""}${event.ctrlKey ? "ctrl+" : ""}${
          event.altKey ? "alt+" : ""
        }${event.shiftKey ? "shift+" : ""}${event.key.toLowerCase()}`;

        if (keys.some(key => 
          key.toLowerCase() === pressedKeyCombo || 
          key.toLowerCase() === cmdKeyCombo
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
