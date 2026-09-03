import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useShortcuts } from "./use-shortcut";

function press(
  key: string,
  opts: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

describe("useShortcuts", () => {
  it("fires the handler on an exact key+mod match", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: "s", mod: true, handler }]));
    press("s", { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the modifier is missing", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: "s", mod: true, handler }]));
    press("s");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire when an unrequested modifier (shift) is also held", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: "s", mod: true, handler }]));
    press("s", { metaKey: true, shiftKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("distinguishes plain vs shifted variants of the same key", () => {
    const run = vi.fn();
    const runTarget = vi.fn();
    renderHook(() =>
      useShortcuts([
        { key: "Enter", mod: true, handler: run },
        { key: "Enter", mod: true, shift: true, handler: runTarget },
      ]),
    );
    press("Enter", { metaKey: true, shiftKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(runTarget).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive on the key", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts([{ key: "S", mod: true, handler }]));
    press("s", { metaKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("skips matching entirely while enabled is false", () => {
    const handler = vi.fn();
    renderHook(() =>
      useShortcuts([{ key: "s", mod: true, handler }], { enabled: false }),
    );
    press("s", { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it("picks up handler changes across re-renders without re-subscribing stale closures", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }) => useShortcuts([{ key: "s", mod: true, handler }]),
      { initialProps: { handler: first } },
    );
    rerender({ handler: second });
    press("s", { metaKey: true });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes its listener on unmount", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useShortcuts([{ key: "s", mod: true, handler }]),
    );
    unmount();
    press("s", { metaKey: true });
    expect(handler).not.toHaveBeenCalled();
  });
});
