import { describe, it, expect, beforeAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { createRef } from "react";
import { useRowWindow } from "./use-row-window";

// JSDOM has no layout engine (clientHeight is always 0) and no
// ResizeObserver — stub both so the hook can be exercised headlessly.
beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    // @ts-expect-error -- minimal stub, only `observe`/`disconnect` are called
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});

function setDims(el: HTMLElement, clientHeight: number) {
  Object.defineProperty(el, "clientHeight", {
    value: clientHeight,
    configurable: true,
  });
}

describe("useRowWindow", () => {
  it("reports the exact total size (count * rowHeight), no measurement", () => {
    const el = document.createElement("div");
    setDims(el, 300);
    const ref = createRef<HTMLDivElement>();
    // @ts-expect-error -- assigning to a readonly ref for the test
    ref.current = el;
    const { result } = renderHook(() => useRowWindow(ref, 1000, 30, 5));
    expect(result.current.getTotalSize()).toBe(30000);
  });

  it("windows to the visible range plus overscan", () => {
    const el = document.createElement("div");
    setDims(el, 300); // 10 rows visible at rowHeight 30
    el.scrollTop = 300; // scrolled down 10 rows
    const ref = createRef<HTMLDivElement>();
    // @ts-expect-error -- assigning to a readonly ref for the test
    ref.current = el;
    const { result } = renderHook(() => useRowWindow(ref, 1000, 30, 2));
    const items = result.current.getVirtualItems();
    // visible rows 10..19, minus 2 overscan on each side -> 8..21
    expect(items[0].index).toBe(8);
    expect(items[items.length - 1].index).toBe(21);
    expect(items[0].start).toBe(8 * 30);
  });

  it("clamps the range to [0, count)", () => {
    const el = document.createElement("div");
    setDims(el, 300);
    el.scrollTop = 0;
    const ref = createRef<HTMLDivElement>();
    // @ts-expect-error -- assigning to a readonly ref for the test
    ref.current = el;
    const { result } = renderHook(() => useRowWindow(ref, 5, 30, 12));
    const items = result.current.getVirtualItems();
    expect(items[0].index).toBe(0);
    expect(items[items.length - 1].index).toBe(4);
  });

  it("scrollToIndex('start') puts the row at the top", () => {
    const el = document.createElement("div");
    setDims(el, 300);
    el.scrollTo = ({ top }: { top: number }) => {
      el.scrollTop = top;
    };
    const ref = createRef<HTMLDivElement>();
    // @ts-expect-error -- assigning to a readonly ref for the test
    ref.current = el;
    const { result } = renderHook(() => useRowWindow(ref, 1000, 30, 0));
    act(() => result.current.scrollToIndex(50, { align: "start" }));
    expect(el.scrollTop).toBe(50 * 30);
  });

  it("scrollToIndex('auto') is a no-op when already fully visible", () => {
    const el = document.createElement("div");
    setDims(el, 300);
    el.scrollTop = 0;
    el.scrollTo = ({ top }: { top: number }) => {
      el.scrollTop = top;
    };
    const ref = createRef<HTMLDivElement>();
    // @ts-expect-error -- assigning to a readonly ref for the test
    ref.current = el;
    const { result } = renderHook(() => useRowWindow(ref, 1000, 30, 0));
    act(() => result.current.scrollToIndex(2, { align: "auto" }));
    expect(el.scrollTop).toBe(0);
  });

  it("scrollToIndex('auto') scrolls just enough when the row is below the viewport", () => {
    const el = document.createElement("div");
    setDims(el, 300); // shows rows 0..9
    el.scrollTop = 0;
    el.scrollTo = ({ top }: { top: number }) => {
      el.scrollTop = top;
    };
    const ref = createRef<HTMLDivElement>();
    // @ts-expect-error -- assigning to a readonly ref for the test
    ref.current = el;
    const { result } = renderHook(() => useRowWindow(ref, 1000, 30, 0));
    act(() => result.current.scrollToIndex(15, { align: "auto" }));
    // row 15 bottom = 480; visible bottom must reach 480 -> scrollTop = 180
    expect(el.scrollTop).toBe(180);
  });
});
