import { Fragment, useLayoutEffect, useRef } from "react";
import { Code, Database, SquarePlus, Terminal } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { Button } from "@/shared/components/ui/button";
import { useStudioStore, type PaneNode, type StudioTab } from "@/shared/store";
import { cn } from "@/shared/lib/utils";
import { TabBar } from "./tab-bar";
import { PaneDropOverlay } from "./pane-drop-overlay";

/** Props shared by every recursion level — the leaf case binds pane-specific
 *  callbacks (select/reorder/split) itself; everything else (close/new-tab/
 *  open-file) is workspace-wide and passed straight through unchanged. */
export interface PaneViewSharedProps {
  connId: string;
  /** True for MongoDB connections — passed straight through to `TabBar`. */
  is_mongo: boolean;
  /** Id of the leaf pane last interacted with — the non-focused panes dim
   *  slightly so it's clear which one is "live". */
  focusedPaneId: string;
  tabsByKey: Map<string, StudioTab>;
  dirty_keys: Set<string>;
  /** Returns (creating on first call) the persistent DOM node a tab's
   *  content is portaled into. STABLE for the tab's whole lifetime — the
   *  same node, never recreated — regardless of which pane currently owns
   *  the tab. Leaves reattach it into their own wrapper imperatively (see
   *  `LeafPaneView`); since the portal's container never changes identity,
   *  React never remounts the tab's component across a split/move, so
   *  in-progress state (pending edits, scroll, editor state) survives. */
  getTabSlot: (tabKey: string) => HTMLDivElement;
  /** Pointer went down on a tab in pane `paneId` — begins the shared
   *  cross-pane drag hook's tracking (see `use-tab-drag.ts`). */
  begin_drag: (
    paneId: string,
    tab: StudioTab,
    clientX: number,
    clientY: number,
  ) => void;
  on_close: (tab: StudioTab) => void;
  on_close_all: () => void;
  on_close_to_left: (tab: StudioTab) => void;
  on_close_to_right: (tab: StudioTab) => void;
  /** Each takes the id of the pane the action was triggered from — a leaf
   *  binds its own `node.id` (see `LeafPaneView`) so a new tab opens into
   *  (and focuses) THAT pane, not whichever pane last had focus. */
  on_new_sql: (paneId: string) => void;
  on_new_table: (paneId: string) => void;
  on_new_mongo_console: (paneId: string) => void;
  on_open_file: (paneId: string) => void;
}

/** Recursively renders a connection's split-view pane tree: nested
 *  `ResizablePanelGroup`s for `split` nodes, a self-contained tab strip +
 *  content slot for `leaf` nodes. Actual tab content is mounted once
 *  (globally, by the caller) and portaled into whichever leaf's slot
 *  currently owns it — see `WorkspaceContent` in `app/studio/workspace.tsx`. */
export function PaneView({
  node,
  ...shared
}: PaneViewSharedProps & { node: PaneNode }) {
  return node.type === "split" ? (
    <SplitPaneView node={node} {...shared} />
  ) : (
    <LeafPaneView node={node} {...shared} />
  );
}

function SplitPaneView({
  node,
  ...shared
}: PaneViewSharedProps & { node: Extract<PaneNode, { type: "split" }> }) {
  const resizeSplit = useStudioStore((s) => s.resizeSplit);
  return (
    <ResizablePanelGroup
      orientation={node.direction}
      onLayoutChanged={(layout) => {
        const sizes = node.children.map(
          (c, i) => layout[c.id] ?? node.sizes[i],
        );
        resizeSplit(shared.connId, node.id, sizes);
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <ResizableHandle
              title="Drag to resize"
              // Matches the sidebar's resize divider: invisible until
              // hovered/dragged, no permanent grip icon.
              className="hover:bg-accent active:bg-primary/60 bg-transparent"
            />
          )}
          <ResizablePanel
            id={child.id}
            defaultSize={`${node.sizes[i]}%`}
            minSize="10%"
          >
            <PaneView node={child} {...shared} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function LeafPaneView({
  node,
  connId,
  is_mongo,
  focusedPaneId,
  tabsByKey,
  dirty_keys,
  getTabSlot,
  begin_drag,
  on_close,
  on_close_all,
  on_close_to_left,
  on_close_to_right,
  on_new_sql,
  on_new_table,
  on_new_mongo_console,
  on_open_file,
}: PaneViewSharedProps & { node: Extract<PaneNode, { type: "leaf" }> }) {
  const selectTab = useStudioStore((s) => s.selectTab);
  const splitPane = useStudioStore((s) => s.splitPane);
  const wrapper_ref = useRef<HTMLDivElement | null>(null);
  const is_focused = node.id === focusedPaneId;

  // Physically attach this pane's tabs' persistent content nodes as
  // children of the wrapper, and show only the active one. Cheap and
  // idempotent (a no-op once already parented/shown), so it's fine to just
  // run after every render rather than track a precise dependency list —
  // `node.tabKeys`/`activeTabKey` can change without `node.id` changing (a
  // tab moving in/out, or the active tab switching). `useLayoutEffect` (not
  // `useEffect`, and not done inline during render) so the DOM move/toggle
  // happens imperatively, after render has committed but before paint —
  // never as a side effect of the render pass itself.
  useLayoutEffect(() => {
    const wrapper = wrapper_ref.current;
    if (!wrapper) return;
    for (const key of node.tabKeys) {
      const slot = getTabSlot(key);
      if (slot.parentElement !== wrapper) wrapper.appendChild(slot);
      slot.style.display = key === node.activeTabKey ? "" : "none";
    }
  });

  const tabs = node.tabKeys
    .map((k) => tabsByKey.get(k))
    .filter((t): t is StudioTab => !!t);
  const active = node.activeTabKey
    ? (tabsByKey.get(node.activeTabKey) ?? null)
    : null;

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-1 flex-col transition-opacity",
        !is_focused && "opacity-80",
      )}
    >
      <TabBar
        paneId={node.id}
        is_mongo={is_mongo}
        tabs={tabs}
        active={active}
        dirty_keys={dirty_keys}
        on_select={(tab) => selectTab(connId, node.id, tab)}
        on_close={on_close}
        on_drag_start={(tab, x, y) => begin_drag(node.id, tab, x, y)}
        on_close_all={on_close_all}
        on_close_to_left={on_close_to_left}
        on_close_to_right={on_close_to_right}
        on_new_sql={() => on_new_sql(node.id)}
        on_new_table={() => on_new_table(node.id)}
        on_new_mongo_console={() => on_new_mongo_console(node.id)}
        on_open_file={() => on_open_file(node.id)}
        on_split_right={(tab) => splitPane(connId, node.id, tab, "right")}
        on_split_down={(tab) => splitPane(connId, node.id, tab, "bottom")}
      />
      <div className="relative min-h-0 flex-1" data-pane-content-id={node.id}>
        <PaneDropOverlay paneId={node.id} />
        {tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <Database className="text-muted-foreground/30 size-10" />
            <div className="flex flex-col gap-1">
              <h2 className="text-foreground text-sm font-medium">
                No tab open
              </h2>
              <p className="text-muted-foreground max-w-xs text-sm">
                Open a table from the sidebar, or start something new here.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={() => on_new_sql(node.id)}>
                <Code className="size-3.5" />
                SQL editor
              </Button>
              {is_mongo && (
                <Button
                  variant="outline"
                  onClick={() => on_new_mongo_console(node.id)}
                >
                  <Terminal className="size-3.5" />
                  NoSQL console
                </Button>
              )}
              <Button variant="outline" onClick={() => on_new_table(node.id)}>
                <SquarePlus className="size-3.5" />
                Create table
              </Button>
            </div>
          </div>
        ) : (
          <div ref={wrapper_ref} className="h-full" />
        )}
      </div>
    </div>
  );
}
