import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export interface VirtualRow {
  index: number;
  start: number;
}

export interface RowWindow {
  getVirtualItems(): VirtualRow[];
  getTotalSize(): number;
  scrollToIndex(
    index: number,
    opts?: { align?: "auto" | "start" | "end" },
  ): void;
}

/**
 * Fixed-row-height replacement for @tanstack/react-virtual's dynamic
 * per-row measurement, which this grid's uniform-height rows never needed
 * (single-line, truncated cells — see grid-body.tsx's own doc comment) and
 * which was the root cause of two bugs: the estimate drifting out of sync
 * with Cell's real padding (a gap at the bottom of a page), and a fragile
 * measure/restore dance around tab visibility (wrong scroll position after
 * switching tabs away and back).
 *
 * Total size and every row's offset are now `count * rowHeight` / `index *
 * rowHeight` — plain arithmetic, never measured or estimated. That also
 * means no special handling is needed for a hidden (display:none) grid: its
 * scrollTop is preserved by the browser across the toggle (unrelated to any
 * virtualization library), the row range is React state that persists
 * across the same hide (the component stays mounted), and the
 * ResizeObserver below already fires on reveal (0 -> real size), which
 * recomputes the range from that already-correct scrollTop. Nothing to
 * save, measure, or restore.
 */
export function useRowWindow(
  scrollRef: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan: number,
): RowWindow {
  const [range, setRange] = useState({ start: 0, end: 0 });
  const raf_ref = useRef(0);

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, clientHeight } = el;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(
      count,
      Math.ceil((scrollTop + clientHeight) / rowHeight) + overscan,
    );
    setRange((cur) =>
      cur.start === start && cur.end === end ? cur : { start, end },
    );
  }, [scrollRef, rowHeight, overscan, count]);

  // A new page/query can shrink or grow `count` out from under the current
  // range (e.g. pointing past the end of a now-shorter list).
  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const on_scroll = () => {
      if (raf_ref.current) return;
      raf_ref.current = requestAnimationFrame(() => {
        raf_ref.current = 0;
        recompute();
      });
    };
    el.addEventListener("scroll", on_scroll, { passive: true });

    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);

    return () => {
      el.removeEventListener("scroll", on_scroll);
      ro.disconnect();
      if (raf_ref.current) cancelAnimationFrame(raf_ref.current);
    };
  }, [scrollRef, recompute]);

  const getVirtualItems = useCallback((): VirtualRow[] => {
    const items: VirtualRow[] = [];
    for (let i = range.start; i < range.end; i++) {
      items.push({ index: i, start: i * rowHeight });
    }
    return items;
  }, [range, rowHeight]);

  const getTotalSize = useCallback(() => count * rowHeight, [count, rowHeight]);

  const scrollToIndex = useCallback(
    (index: number, opts?: { align?: "auto" | "start" | "end" }) => {
      const el = scrollRef.current;
      if (!el) return;
      const align = opts?.align ?? "auto";
      const item_top = index * rowHeight;
      const item_bottom = item_top + rowHeight;
      if (align === "start") {
        el.scrollTo({ top: item_top });
        return;
      }
      if (align === "end") {
        el.scrollTo({ top: item_bottom - el.clientHeight });
        return;
      }
      // "auto": leave it alone if the row is already fully visible.
      const view_top = el.scrollTop;
      const view_bottom = view_top + el.clientHeight;
      if (item_top < view_top) {
        el.scrollTo({ top: item_top });
      } else if (item_bottom > view_bottom) {
        el.scrollTo({ top: item_bottom - el.clientHeight });
      }
    },
    [scrollRef, rowHeight],
  );

  return { getVirtualItems, getTotalSize, scrollToIndex };
}
