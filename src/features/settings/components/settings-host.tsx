import { useStudioStore } from "@/shared/store";
import { useAppShortcut, useShortcuts } from "@/shared/hooks/use-shortcut";
import { SettingsDialog } from "./settings-dialog";

/** The one app-wide settings dialog, toggled by the gear button or Cmd/Ctrl+,. */
export function SettingsHost() {
  const open = useStudioStore((s) => s.settingsOpen);
  const setOpen = useStudioStore((s) => s.setSettingsOpen);
  const binding = useAppShortcut("app.openSettings");
  useShortcuts([
    {
      ...binding,
      handler: () => setOpen(!useStudioStore.getState().settingsOpen),
    },
  ]);

  return <SettingsDialog open={open} onOpenChange={setOpen} />;
}
