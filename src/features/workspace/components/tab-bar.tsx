import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Code, Plus, SquarePlus, Terminal, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { TabTypeIcon } from "@/shared/components/tab-type-icon";
import { cn } from "@/shared/lib/utils";
import { tabEquals, tabKey, tabLabel, type StudioTab } from "@/shared/store";

interface TabBarProps {
  tabs: StudioTab[];
  active: StudioTab | null;
  /** Keys of tabs holding unapplied work — shown as a dot until hovered. */
  dirty_keys: Set<string>;
  on_select: (tab: StudioTab) => void;
  on_close: (tab: StudioTab) => void;
  /** Drop `tab` so it ends up at `to_index` of the strip. */
  on_reorder: (tab: StudioTab, to_index: number) => void;
  on_close_all: () => void;
  on_close_to_left: (tab: StudioTab) => void;
  on_close_to_right: (tab: StudioTab) => void;
  on_new_sql: () => void;
  on_new_table: () => void;
  on_new_mongo_console: () => void;
}

export function TabBar({
  tabs,
  active,
  dirty_keys,
  on_select,
  on_close,
  on_reorder,
  on_close_all,
  on_close_to_left,
  on_close_to_right,
  on_new_sql,
  on_new_table,
  on_new_mongo_console,
}: TabBarProps) {
  // ---- Drag to rearrange (pointer-based; HTML5 DnD is flaky in WebViews) --
  // pointerdown records a candidate; after >4px the drag activates and tabs
  // LIVE-REORDER under the pointer (Chrome-style): crossing a neighbour's
  // midpoint shifts the strip immediately, so the dragged tab visibly
  // travels with the cursor. A ghost chip also follows the pointer.
  const [drag_key, setDragKey] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const pending = useRef<{
    key: string;
    start_x: number;
    moved: boolean;
  } | null>(null);
  const suppress_click = useRef(false);
  const tabs_ref = useRef(tabs);
  const reorder_ref = useRef(on_reorder);
  // Keep latest values reachable from the always-on window listeners.
  useEffect(() => {
    tabs_ref.current = tabs;
    reorder_ref.current = on_reorder;
  });

  const on_strip_pointer_down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // close X, +, menu buttons
    const el = target.closest("[data-tab-key]");
    if (!el) return;
    pending.current = {
      key: el.getAttribute("data-tab-key") ?? "",
      start_x: e.clientX,
      moved: false,
    };
  };

  useEffect(() => {
    /** Strip position the pointer currently points at (insert index). */
    const hovered_index = (client_x: number): number | null => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>("[data-tab-index]"),
      );
      for (const it of items) {
        const r = it.getBoundingClientRect();
        if (client_x < r.left + r.width / 2) return Number(it.dataset.tabIndex);
      }
      return items.length > 0 ? items.length : null;
    };

    const on_move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p) return;
      if (!p.moved) {
        if (Math.abs(e.clientX - p.start_x) < 4) return;
        p.moved = true;
        setDragKey(p.key);
      }
      setGhost({ x: e.clientX, y: e.clientY });
      // Live reorder: move the tab the moment the cursor crosses a
      // neighbour's midpoint, so it travels with the pointer.
      const idx = hovered_index(e.clientX);
      if (idx == null) return;
      const cur = tabs_ref.current;
      const from = cur.findIndex((t) => tabKey(t) === p.key);
      if (from < 0) return;
      let target = idx;
      if (target > from) target -= 1;
      if (target !== from && target >= 0 && target < cur.length) {
        reorder_ref.current(cur[from], target);
      }
    };

    const on_up = () => {
      const p = pending.current;
      pending.current = null;
      setDragKey(null);
      setGhost(null);
      if (p?.moved) suppress_click.current = true;
    };

    window.addEventListener("pointermove", on_move);
    window.addEventListener("pointerup", on_up);
    return () => {
      window.removeEventListener("pointermove", on_move);
      window.removeEventListener("pointerup", on_up);
    };
  });

  return (
    <div
      className="bg-background min-h-8.5 max-h-8.5 flex w-full shrink-0 scrollbar-none items-center gap-1 overflow-x-auto border-b pl-1.5 [&::-webkit-scrollbar]:hidden"
      onPointerDown={on_strip_pointer_down}
      // A real drag suppresses the follow-up click so tabs don't get selected.
      onClickCapture={(e) => {
        if (suppress_click.current) {
          e.stopPropagation();
          suppress_click.current = false;
        }
      }}
    >
      {tabs.map((tab, idx) => {
        const key = tabKey(tab);
        return (
          <TabItem
            key={key}
            tab={tab}
            index={idx}
            total={tabs.length}
            active={tabEquals(tab, active)}
            dirty={dirty_keys.has(key)}
            dragging={drag_key === key}
            on_select={on_select}
            on_close={on_close}
            on_close_all={on_close_all}
            on_close_to_left={on_close_to_left}
            on_close_to_right={on_close_to_right}
          />
        );
      })}
      {/* Drop zone past the end of the strip (append position). */}
      <div className="bg-background sticky right-0 z-10 ml-0.5 flex h-full min-w-3 shrink-0 items-center gap-0.5 rounded-md">
        <Button
          variant="ghost"
          size="iconXs"
          aria-label="Open a new SQL editor"
          title="New SQL editor"
          onClick={on_new_sql}
        >
          <Plus className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="More actions"
                title="More actions"
              >
                <ChevronDown className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={on_new_sql}>
              <Code className="text-muted-foreground size-4" />
              SQL editor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={on_new_mongo_console}>
              <Terminal className="text-muted-foreground size-4" />
              NoSQL console
            </DropdownMenuItem>
            <DropdownMenuItem onClick={on_new_table}>
              <SquarePlus className="text-muted-foreground size-4" />
              Create table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Floating drag ghost following the pointer. */}
      {drag_key !== null &&
        ghost !== null &&
        createPortal(
          (() => {
            const t = tabs.find((x) => tabKey(x) === drag_key);
            if (!t) return null;
            return (
              <div
                className="bg-popover text-foreground pointer-events-none fixed z-50 flex max-w-56 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm whitespace-nowrap shadow-lg"
                style={{ left: ghost.x, top: ghost.y }}
              >
                <TabTypeIcon tab={t} />
                <span className="truncate">{tabLabel(t)}</span>
              </div>
            );
          })(),
          document.body,
        )}
    </div>
  );
}

function TabItem({
  tab,
  index,
  total,
  active,
  dirty,
  dragging,
  on_select,
  on_close,
  on_close_all,
  on_close_to_left,
  on_close_to_right,
}: {
  tab: StudioTab;
  /** Strip position of this tab (0-based) and the total tab count. */
  index: number;
  total: number;
  active: boolean;
  dirty: boolean;
  dragging: boolean;
  on_select: (tab: StudioTab) => void;
  on_close: (tab: StudioTab) => void;
  on_close_all: () => void;
  on_close_to_left: (tab: StudioTab) => void;
  on_close_to_right: (tab: StudioTab) => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            data-tab-key={tabKey(tab)}
            data-tab-index={index}
            onClick={() => on_select(tab)}
            className={cn(
              "relative flex max-w-[16rem] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-sm whitespace-nowrap select-none",
              active
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
              // While dragging, the tab itself dims and lifts like a slot.
              dragging && "ring-primary/60 opacity-30 ring-2",
            )}
          >
            <TabTypeIcon tab={tab} />
            <span className="max-w-56 truncate">{tabLabel(tab)}</span>
            {/* Dirty tabs show a dot; hovering it reveals the close X. */}
            {dirty ? (
              <span
                className="group relative -mr-1 ml-0.5 flex size-5 items-center justify-center"
                title="Unsaved changes"
              >
                <span className="absolute size-1.75 rounded-full bg-current opacity-70 transition-opacity group-hover:opacity-0" />
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Close tab (unsaved changes — you will be asked)"
                  className="absolute inset-0 size-5 opacity-0 group-hover:opacity-60 hover:opacity-100!"
                  onClick={(e) => {
                    e.stopPropagation();
                    on_close(tab);
                  }}
                >
                  <X className="size-3.5" />
                </Button>
              </span>
            ) : (
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Close tab"
                className="-mr-1 ml-0.5 size-5 opacity-60 hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  on_close(tab);
                }}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onClick={() => on_close(tab)}>Close</ContextMenuItem>
        {/* Contextual availability: nothing to close → nothing to click. */}
        <ContextMenuItem disabled={total <= 1} onClick={() => on_close_all()}>
          Close all
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={index === 0}
          onClick={() => on_close_to_left(tab)}
        >
          Close to the left
        </ContextMenuItem>
        <ContextMenuItem
          disabled={index >= total - 1}
          onClick={() => on_close_to_right(tab)}
        >
          Close to the right
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
