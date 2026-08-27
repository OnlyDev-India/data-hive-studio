import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Braces } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import { buildLines, collectMatches } from "./json-lines";
import { TreeControls } from "./tree-controls";
import { TreeBody } from "./tree-body";

const sidebarTransition: Transition = { duration: 0.22, ease: "easeOut" };

/** Right-hand inspector: pretty-printed JSON of the selected grid row with
 *  search, collapse and an expanded-dialog mode. Resizable by its left edge. */
export function JsonViewer() {
  const jsonRow = useStudioStore((s) => s.jsonRow);
  const width = useStudioStore((s) => s.rightSidebarWidth);
  const setWidth = useStudioStore((s) => s.setRightSidebarWidth);
  const close = useStudioStore((s) => s.setRightSidebarOpen);

  const [dragging, setDragging] = useState(false);
  const drag_ref = useRef<{ start_x: number; start_w: number } | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const on_move = (e: PointerEvent) => {
      const d = drag_ref.current;
      if (!d) return;
      const w = d.start_w + (d.start_x - e.clientX);
      setWidth(Math.min(560, Math.max(240, w)));
    };
    const on_up = () => {
      setDragging(false);
      drag_ref.current = null;
    };
    window.addEventListener("pointermove", on_move);
    window.addEventListener("pointerup", on_up);
    return () => {
      window.removeEventListener("pointermove", on_move);
      window.removeEventListener("pointerup", on_up);
    };
  }, [dragging, setWidth]);

  // Which nodes are collapsed, keyed by their JSON path (e.g. `$.meta`).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Search: while active, everything is expanded so matches are visible.
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searching = query.trim().length > 0;

  const lines = useMemo(() => {
    if (!jsonRow) return [];
    return buildLines(jsonRow.data, searching ? new Set() : collapsed);
  }, [jsonRow, searching, collapsed]);

  const matches = useMemo(() => collectMatches(lines, query), [lines, query]);
  const activeLineId = matches[Math.min(activeMatch, matches.length - 1)]?.id;

  const goNext = useCallback(() => {
    if (matches.length === 0) return;
    setActiveMatch((a) => (a + 1) % matches.length);
  }, [matches.length]);
  const goPrev = useCallback(() => {
    if (matches.length === 0) return;
    setActiveMatch((a) => (a - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const copy = () => {
    if (!jsonRow) return;
    void navigator.clipboard.writeText(JSON.stringify(jsonRow.data, null, 2));
  };

  // Long lines wrap onto the next line when enabled; off keeps one token per line.
  const [wrap, setWrap] = useState(true);

  // The dialog reuses the exact same content via a shared `layoutId`, so
  // opening/closing morphs the sidebar viewer into the dialog and back.
  const [dialogOpen, setDialogOpen] = useState(false);
  useEffect(() => {
    if (!dialogOpen) return;
    const on_key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, [dialogOpen]);

  const headerProps = {
    query,
    onQueryChange: (q: string) => {
      setQuery(q);
      setActiveMatch(0);
    },
    searching,
    matchCount: matches.length,
    activeMatch,
    onPrev: goPrev,
    onNext: goNext,
    onClear: () => {
      setQuery("");
      setActiveMatch(0);
    },
    wrap,
    onToggleWrap: () => setWrap((w) => !w),
    onCopy: copy,
    onClose: () => close(false),
  };

  return (
    <>
      <motion.aside
        initial={{ width: 0, opacity: 0 }}
        animate={{ width, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={dragging ? { width: { duration: 0 } } : sidebarTransition}
        className="bg-background relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l"
      >
        <motion.div
          layoutId="json-panel"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          style={{ width }}
        >
          <TreeControls {...headerProps} onExpand={() => setDialogOpen(true)} />
          {jsonRow ? (
            <TreeBody
              lines={lines}
              collapsed={collapsed}
              toggle={toggle}
              searching={searching}
              activeLineId={activeLineId}
              wrap={wrap}
              query={query}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <Braces className="text-muted-foreground/40 size-8" />
              <p className="text-muted-foreground text-sm">
                No row selected. Right-click any grid cell and choose “View
                JSON” to inspect its row here.
              </p>
            </div>
          )}
        </motion.div>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag_ref.current = { start_x: e.clientX, start_w: width };
            setDragging(true);
          }}
          className={cn(
            "absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize",
            dragging ? "bg-primary/60" : "hover:bg-accent bg-transparent",
          )}
        />
      </motion.aside>

      <AnimatePresence>
        {dialogOpen && jsonRow && (
          <motion.div
            key="json-dialog"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setDialogOpen(false)}
          >
            <motion.div
              layoutId="json-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Row JSON"
              className="bg-background pointer-events-auto flex h-[80vh] w-[min(760px,92vw)] min-w-0 flex-col overflow-hidden rounded-xl border shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <TreeControls
                {...headerProps}
                onClose={() => setDialogOpen(false)}
              />
              <TreeBody
                lines={lines}
                collapsed={collapsed}
                toggle={toggle}
                searching={searching}
                activeLineId={activeLineId}
                wrap={wrap}
                query={query}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
