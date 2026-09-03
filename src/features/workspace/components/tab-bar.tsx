import {
  ChevronDown,
  Code,
  FileText,
  Plus,
  SplitSquareHorizontal,
  SplitSquareVertical,
  SquarePlus,
  Terminal,
  X,
} from "lucide-react";
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
import {
  tabEquals,
  tabKey,
  tabLabel,
  useStudioStore,
  type StudioTab,
} from "@/shared/store";
import { shouldSuppressTabClick } from "../lib/use-tab-drag";

interface TabBarProps {
  /** Id of the leaf pane this strip belongs to — stamped on each tab item
   *  (`data-tab-pane`) so the shared cross-pane drag hook can tell strips
   *  apart when several are mounted at once. */
  paneId: string;
  tabs: StudioTab[];
  active: StudioTab | null;
  /** Keys of tabs holding unapplied work — shown as a dot until hovered. */
  dirty_keys: Set<string>;
  on_select: (tab: StudioTab) => void;
  on_close: (tab: StudioTab) => void;
  /** Pointer went down on `tab` — hands off to the shared drag hook, which
   *  owns activation threshold, live reorder, and drop-zone detection. */
  on_drag_start: (tab: StudioTab, clientX: number, clientY: number) => void;
  on_close_all: () => void;
  on_close_to_left: (tab: StudioTab) => void;
  on_close_to_right: (tab: StudioTab) => void;
  on_new_sql: () => void;
  on_new_table: () => void;
  on_new_mongo_console: () => void;
  /** Opens a local .sql file into a new SQL editor tab, seeded with its
   *  contents. */
  on_open_file: () => void;
  /** Split this pane, moving `tab` into a brand-new pane on that side. */
  on_split_right: (tab: StudioTab) => void;
  on_split_down: (tab: StudioTab) => void;
}

export function TabBar({
  paneId,
  tabs,
  active,
  dirty_keys,
  on_select,
  on_close,
  on_drag_start,
  on_close_all,
  on_close_to_left,
  on_close_to_right,
  on_new_sql,
  on_new_table,
  on_new_mongo_console,
  on_open_file,
  on_split_right,
  on_split_down,
}: TabBarProps) {
  const on_strip_pointer_down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // close X, +, menu buttons
    const el = target.closest("[data-tab-key]");
    if (!el) return;
    const key = el.getAttribute("data-tab-key");
    const tab = tabs.find((t) => tabKey(t) === key);
    if (!tab) return;
    on_drag_start(tab, e.clientX, e.clientY);
  };

  return (
    <div
      className="bg-background min-h-8.5 max-h-8.5 flex w-full shrink-0 scrollbar-none items-center gap-1 overflow-x-auto border-b pl-1.5 [&::-webkit-scrollbar]:hidden"
      onPointerDown={on_strip_pointer_down}
      // A real drag suppresses the follow-up click so tabs don't get selected.
      onClickCapture={(e) => {
        if (shouldSuppressTabClick()) e.stopPropagation();
      }}
    >
      {tabs.map((tab, idx) => {
        const key = tabKey(tab);
        return (
          <TabItem
            key={key}
            pane_id={paneId}
            tab={tab}
            index={idx}
            total={tabs.length}
            active={tabEquals(tab, active)}
            dirty={dirty_keys.has(key)}
            on_select={on_select}
            on_close={on_close}
            on_close_all={on_close_all}
            on_close_to_left={on_close_to_left}
            on_close_to_right={on_close_to_right}
            on_split_right={on_split_right}
            on_split_down={on_split_down}
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
          onClick={() => on_new_sql()}
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
          <DropdownMenuContent align="end" className={"w-full"}>
            {/* Every handler here is wrapped in a no-arg arrow — passed
                directly, onClick would call it with the click event as the
                first argument, which for on_new_mongo_console (optional
                seedText/seedFileName params) silently became a bogus seed
                (rendered as "[object Object]" once the editor stringified
                it) instead of a real open-console call. */}
            <DropdownMenuItem onClick={() => on_new_sql()}>
              <Code className="text-muted-foreground size-4" />
              SQL editor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => on_new_mongo_console()}>
              <Terminal className="text-muted-foreground size-4" />
              NoSQL console
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => on_new_table()}>
              <SquarePlus className="text-muted-foreground size-4" />
              Create table
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => on_open_file()}>
              <FileText className="text-muted-foreground size-4" />
              Open file…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TabItem({
  pane_id,
  tab,
  index,
  total,
  active,
  dirty,
  on_select,
  on_close,
  on_close_all,
  on_close_to_left,
  on_close_to_right,
  on_split_right,
  on_split_down,
}: {
  pane_id: string;
  tab: StudioTab;
  /** Strip position of this tab (0-based) and the total tab count. */
  index: number;
  total: number;
  active: boolean;
  dirty: boolean;
  on_select: (tab: StudioTab) => void;
  on_close: (tab: StudioTab) => void;
  on_close_all: () => void;
  on_close_to_left: (tab: StudioTab) => void;
  on_close_to_right: (tab: StudioTab) => void;
  on_split_right: (tab: StudioTab) => void;
  on_split_down: (tab: StudioTab) => void;
}) {
  const key = tabKey(tab);
  const file_name = useStudioStore((s) => s.sqlTabs[key]?.file_name);
  const dragging = useStudioStore(
    (s) => !!s.dragTab && tabKey(s.dragTab.tab) === key,
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            role="button"
            tabIndex={0}
            data-tab-key={key}
            data-tab-index={index}
            data-tab-pane={pane_id}
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
            <span className="max-w-56 truncate">{tabLabel(tab, file_name)}</span>
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
        <ContextMenuSeparator />
        <ContextMenuItem disabled={total <= 1} onClick={() => on_split_right(tab)}>
          <SplitSquareHorizontal className="text-muted-foreground size-4" />
          Split right
        </ContextMenuItem>
        <ContextMenuItem disabled={total <= 1} onClick={() => on_split_down(tab)}>
          <SplitSquareVertical className="text-muted-foreground size-4" />
          Split down
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
