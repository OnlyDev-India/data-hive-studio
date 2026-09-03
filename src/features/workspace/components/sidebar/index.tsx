import { useEffect, useRef, useState } from "react";
import { cn } from "@/shared/lib/utils";
import type { ActivityEntry, TableInfo } from "@/shared/api";
import { useStudioStore } from "@/shared/store";
import { ActivityView } from "./activity-view";
import { HomeView } from "./home-view";
import { TablesBrowser } from "./tables-view";

interface SidebarProps {
  conn_id: string;
  tables: TableInfo[] | null;
  active_table: string | null;
  on_open_table: (name: string) => void;
  show_table_tools: boolean;
  on_refresh: () => void;
  /** A tables (re)load is in flight — spinner + skeleton rows. */
  reloading?: boolean;
  /** "tables" (default): database browser. "activity": the SAME sidebar
   *  showing the backend-command feed — one persistent sidebar, only its
   *  content switches. */
  mode?: "tables" | "activity";
  /** Activity mode: X button collapses the left panel slot. */
  on_activity_close?: () => void;
  /** Activity mode: clicking an entry opens/updates the details tab. */
  on_activity_select?: (entry: ActivityEntry) => void;
}

/** Left panel frame: width + resize handle, then one of three views —
 *  database browser, landing connections list, or the activity feed. */
export function Sidebar({
  conn_id,
  tables,
  active_table,
  on_open_table,
  show_table_tools,
  on_refresh,
  reloading = false,
  mode = "tables",
  on_activity_close,
  on_activity_select,
}: SidebarProps) {
  const [search, setSearch] = useState("");

  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);
  const setSidebarWidth = useStudioStore((s) => s.setSidebarWidth);

  // Drag the right edge to resize (160–480px).
  const [dragging, setDragging] = useState(false);
  const drag_ref = useRef<{ start_x: number; start_w: number } | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const on_move = (e: PointerEvent) => {
      const d = drag_ref.current;
      if (!d) return;
      const w = d.start_w + (e.clientX - d.start_x);
      setSidebarWidth(Math.min(480, Math.max(160, w)));
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
  }, [dragging, setSidebarWidth]);

  return (
    <aside
      className="bg-background relative flex h-full shrink-0 flex-col gap-3 overflow-hidden border-r"
      style={{ width: sidebarWidth }}
    >
      {mode === "activity" ? (
        <ActivityView
          conn_id={conn_id}
          on_close={on_activity_close}
          on_select={on_activity_select}
        />
      ) : show_table_tools ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
          <TablesBrowser
            conn_id={conn_id}
            tables={tables}
            active_table={active_table}
            on_open_table={on_open_table}
            on_refresh={on_refresh}
            reloading={reloading}
            search_value={search}
            on_search_change={setSearch}
          />
        </div>
      ) : (
        <HomeView search_value={search} on_search_change={setSearch} />
      )}

      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag_ref.current = { start_x: e.clientX, start_w: sidebarWidth };
          setDragging(true);
        }}
        className={cn(
          "absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize",
          dragging ? "bg-primary/60" : "hover:bg-accent bg-transparent",
        )}
      />
    </aside>
  );
}
