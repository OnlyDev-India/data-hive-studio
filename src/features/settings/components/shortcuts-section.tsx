import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/shared/components/ui";
import { useStudioStore } from "@/shared/store";
import {
  bindingEquals,
  formatBinding,
  SHORTCUT_ACTIONS,
  type ShortcutBinding,
} from "@/shared/hooks/shortcut-registry";
import { Kbd, KbdGroup } from "@/shared/components/ui/kbd";

/** Modifier keys pressed alone (still composing a combo) never count as a
 *  capture on their own — only a real key finishes recording. */
const PURE_MODIFIERS = new Set(["Control", "Meta", "Shift", "Alt"]);

function eventToBinding(e: KeyboardEvent): ShortcutBinding | null {
  if (PURE_MODIFIERS.has(e.key)) return null;
  return {
    key: e.key,
    mod: e.metaKey || e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
  };
}

/** Lets the user remap the app's customizable keyboard shortcuts
 *  (`shortcut-registry.ts`'s `SHORTCUT_ACTIONS`). Clicking "Change" enters a
 *  one-shot recording mode: the next real key combo becomes the new
 *  binding, checked against every other action's EFFECTIVE binding
 *  (override or default) so two actions can never collide. */
export function ShortcutsSection() {
  const overrides = useStudioStore((s) => s.shortcutOverrides);
  const setOverride = useStudioStore((s) => s.setShortcutOverride);
  const resetOne = useStudioStore((s) => s.resetShortcut);
  const resetAll = useStudioStore((s) => s.resetAllShortcuts);

  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordingId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingId(null);
        setError(null);
        return;
      }
      const binding = eventToBinding(e);
      if (!binding) return; // a bare modifier — keep waiting
      const conflict = SHORTCUT_ACTIONS.find((a) => {
        if (a.id === recordingId) return false;
        const effective = overrides[a.id] ?? a.default;
        return bindingEquals(effective, binding);
      });
      if (conflict) {
        setError(`Already used by "${conflict.label}"`);
        return;
      }
      setOverride(recordingId, binding);
      setRecordingId(null);
      setError(null);
    };
    // Capture phase: outruns every feature's own `useShortcuts` listener so
    // recording a combo never also triggers whatever it's currently bound to.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId, overrides, setOverride]);

  const has_overrides = Object.keys(overrides).length > 0;

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-lg font-semibold">Shortcuts</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Remap the app's keyboard shortcuts. Click Change, then press a new key
          combo — Escape cancels.
        </p>
      </header>

      <div className="divide-border divide-y rounded-xl border">
        {SHORTCUT_ACTIONS.map((action) => {
          const effective = overrides[action.id] ?? action.default;
          const is_default = bindingEquals(effective, action.default);
          const recording = recordingId === action.id;
          const shortcut_keys = formatBinding(effective);
          return (
            <div
              key={action.id}
              className="flex items-center justify-between gap-6 px-4 py-3"
            >
              <span className="text-sm font-medium">{action.label}</span>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2">
                  {recording ? (
                    <span className="text-muted-foreground text-3xs italic">
                      Press a key…
                    </span>
                  ) : (
                    <KbdGroup>
                      {shortcut_keys.map((key, idx) => (
                        <Kbd key={idx}>{key}</Kbd>
                      ))}
                    </KbdGroup>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setError(null);
                      setRecordingId(recording ? null : action.id);
                    }}
                  >
                    {recording ? "Cancel" : "Change"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconXs"
                    aria-label={`Reset ${action.label}`}
                    title="Reset to default"
                    disabled={is_default}
                    onClick={() => resetOne(action.id)}
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                </div>
                {recording && error && (
                  <span className="text-destructive text-xs">{error}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Button
        variant="outline"
        className="w-fit"
        disabled={!has_overrides}
        onClick={resetAll}
      >
        <RotateCcw className="size-4" /> Reset all to defaults
      </Button>
    </div>
  );
}
