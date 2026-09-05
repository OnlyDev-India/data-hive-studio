import { useEffect, useRef } from "react";
import { useStudioStore, type StudioTab } from "@/shared/store";

interface PendingDrag {
  connId: string;
  paneId: string;
  tab: StudioTab;
  startX: number;
  startY: number;
  moved: boolean;
}

// Singleton (not per-TabBar) — a drag is one app-wide operation, and the
// click that ends it fires synchronously right after pointerup, before a
// React re-render could clear store state in time. A module-level flag
// avoids that race entirely.
let suppress_next_click = false;
/** Call from a tab's onClickCapture; true means "a drag just ended, eat
 *  this click instead of treating it as a tab select." Self-resetting. */
export function shouldSuppressTabClick(): boolean {
  if (suppress_next_click) {
    suppress_next_click = false;
    return true;
  }
  return false;
}

/** Shared cross-pane drag-to-reorder / drag-to-split coordination, owned
 *  ONCE per workspace (not once per TabBar) — with split-view there can be
 *  several simultaneously-mounted TabBar instances, and a single pointer
 *  drag must be able to span all of them (drag out of one pane's strip,
 *  hover another pane's strip or content area, drop). Pointer-based, not
 *  HTML5 DnD (flaky in WebViews) — mirrors the same-pane drag this app
 *  already had, generalized across panes.
 *
 *  Returns `begin_drag`, called from a TabBar's onPointerDown; everything
 *  after that (activation threshold, live reorder, drop-zone detection,
 *  commit) happens here via window-level listeners. */
export function useTabDrag(connId: string) {
  const pending = useRef<PendingDrag | null>(null);
  const last_strip = useRef<{ paneId: string; index: number } | null>(null);
  const setDragTab = useStudioStore((s) => s.setDragTab);
  const setDragPointer = useStudioStore((s) => s.setDragPointer);
  const setDropTarget = useStudioStore((s) => s.setDropTarget);
  const movePaneTab = useStudioStore((s) => s.movePaneTab);
  const splitPane = useStudioStore((s) => s.splitPane);

  const begin_drag = (
    paneId: string,
    tab: StudioTab,
    clientX: number,
    clientY: number,
  ) => {
    pending.current = {
      connId,
      paneId,
      tab,
      startX: clientX,
      startY: clientY,
      moved: false,
    };
  };

  useEffect(() => {
    /** Any tab strip the pointer is currently over (any pane), and the
     *  insert index within it — mirrors the single-strip version this app
     *  already had, just scanning every mounted strip via `data-tab-pane`. */
    const hovered_strip = (
      x: number,
      y: number,
    ): { paneId: string; index: number } | null => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tab-pane]"),
      );
      const in_row = items.filter((it) => {
        const r = it.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      });
      if (in_row.length === 0) return null;
      for (const it of in_row) {
        const r = it.getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          return {
            paneId: it.dataset.tabPane ?? "",
            index: Number(it.dataset.tabIndex),
          };
        }
      }
      const last = in_row[in_row.length - 1];
      return {
        paneId: last.dataset.tabPane ?? "",
        index: Number(last.dataset.tabIndex) + 1,
      };
    };

    /** Which pane's CONTENT area (below any strip) the pointer is over, and
     *  which edge is closest: if the closest edge is within 25% of that
     *  edge's own axis span, it wins (→ split); otherwise "center" (→ plain
     *  move, no split). */
    const hovered_pane_content = (
      x: number,
      y: number,
    ): {
      paneId: string;
      edge: "left" | "right" | "top" | "bottom" | "center";
    } | null => {
      const panes = Array.from(
        document.querySelectorAll<HTMLElement>("[data-pane-content-id]"),
      );
      // Subpixel slack: a drop right at (or a couple px past) a pane's outer
      // edge can otherwise fall just outside its fractional getBoundingClientRect
      // against the integer pointer coordinate — most visible for a single,
      // unsplit pane, where that edge IS the window edge and every drop meant
      // to create the first split lands exactly there.
      const EDGE_SLOP = 8;
      for (const el of panes) {
        const r = el.getBoundingClientRect();
        if (
          x < r.left - EDGE_SLOP ||
          x > r.right + EDGE_SLOP ||
          y < r.top - EDGE_SLOP ||
          y > r.bottom + EDGE_SLOP
        )
          continue;
        const candidates: [number, "left" | "right" | "top" | "bottom", number][] =
          [
            [x - r.left, "left", r.width],
            [r.right - x, "right", r.width],
            [y - r.top, "top", r.height],
            [r.bottom - y, "bottom", r.height],
          ];
        candidates.sort((a, b) => a[0] - b[0]);
        const [minDist, edge, span] = candidates[0];
        const paneId = el.dataset.paneContentId ?? "";
        return { paneId, edge: span > 0 && minDist / span < 0.25 ? edge : "center" };
      }
      return null;
    };

    const on_move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!p.moved) {
        if (
          Math.abs(e.clientX - p.startX) < 4 &&
          Math.abs(e.clientY - p.startY) < 4
        )
          return;
        p.moved = true;
        setDragTab({ connId: p.connId, sourcePaneId: p.paneId, tab: p.tab });
      }
      setDragPointer({ x: e.clientX, y: e.clientY });

      const strip = hovered_strip(e.clientX, e.clientY);
      if (strip && strip.paneId) {
        setDropTarget(null);
        const last = last_strip.current;
        if (!last || last.paneId !== strip.paneId || last.index !== strip.index) {
          last_strip.current = strip;
          movePaneTab(p.connId, p.tab, strip.paneId, strip.index);
        }
        return;
      }
      last_strip.current = null;
      const zone = hovered_pane_content(e.clientX, e.clientY);
      setDropTarget(zone && zone.paneId ? zone : null);
    };

    const on_up = () => {
      const p = pending.current;
      pending.current = null;
      last_strip.current = null;
      if (p?.moved) {
        suppress_next_click = true;
        const dt = useStudioStore.getState().dropTarget;
        if (dt && dt.edge !== "center") {
          splitPane(p.connId, dt.paneId, p.tab, dt.edge);
        } else if (dt && dt.edge === "center") {
          movePaneTab(p.connId, p.tab, dt.paneId, Number.MAX_SAFE_INTEGER);
        }
      }
      setDragTab(null);
      setDragPointer(null);
      setDropTarget(null);
    };

    window.addEventListener("pointermove", on_move);
    window.addEventListener("pointerup", on_up);
    return () => {
      window.removeEventListener("pointermove", on_move);
      window.removeEventListener("pointerup", on_up);
    };
  }, [setDragTab, setDragPointer, setDropTarget, movePaneTab, splitPane]);

  return { begin_drag };
}
