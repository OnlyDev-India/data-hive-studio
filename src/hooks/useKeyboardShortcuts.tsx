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
        const pressedKeyCombo = `${event.ctrlKey ? "Ctrl+" : ""}${
          event.altKey ? "Alt+" : ""
        }${event.shiftKey ? "Shift+" : ""}${event.key}`;

        if (keys.includes(pressedKeyCombo)) {
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
