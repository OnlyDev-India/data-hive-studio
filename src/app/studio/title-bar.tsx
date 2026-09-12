import { useEffect, useRef, useState } from "react";
import {
  ArrowUpCircle,
  ChevronDown,
  Minus,
  Square,
  SquareStack,
  X,
} from "lucide-react";
import { WEB } from "@/shared/api/web";
import { cn } from "@/shared/lib/utils";
import { useActiveConnection, useStudioStore } from "@/shared/store";
import DisconnectDbBtn from "@/shared/components/disconnect-db-btn";
import PanelLeftIcon from "@/shared/components/icons/panel-left";
import PanelRightIcon from "@/shared/components/icons/panel-right";
import { Input } from "@/shared/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { TITLE_BAR_MENUS } from "./menu-schema";
import { handleMenuAction } from "./native-menu";
import { DBIcons } from "@/shared/components/icons/types";

const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
const IS_WINDOWS =
  typeof navigator !== "undefined" && /win/i.test(navigator.userAgent);

/** Every desktop platform gets a custom top bar now (matches VS Code on all
 *  three), always three sections: whichever side the OS puts its own
 *  window buttons on (left for macOS traffic lights, right for
 *  Windows/Linux) also holds the menu (Windows/Linux) or is otherwise
 *  reserved space (macOS); the opposite/remaining side holds the other
 *  buttons (sidebar + JSON panel toggles); the middle is the app title, or
 *  (see `ConnectionSwitcher`) a dropdown between open connections once one
 *  is open — the connection-tabs strip that used to live inside each
 *  workspace (connection-tabs.tsx) was removed in favor of this, since the
 *  title bar is persistent chrome and the tabs strip wasn't. */
export function shouldShowTitleBar(): boolean {
  return !WEB;
}

type WindowApi = Awaited<
  ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>
>;

export function TitleBar() {
  if (IS_MAC) return <MacTitleBar />;
  return <WindowsLinuxTitleBar />;
}

function LeftPanelToggleButton({ className }: { className?: string }) {
  const leftPanelOpen = useStudioStore((s) => s.leftPanelOpen);
  const toggleLeftPanelOpen = useStudioStore((s) => s.toggleLeftPanelOpen);
  return (
    <button
      type="button"
      aria-label={
        leftPanelOpen ? "Hide the left sidebar" : "Show the left sidebar"
      }
      title={leftPanelOpen ? "Hide the left sidebar" : "Show the left sidebar"}
      className={className}
      onClick={() => toggleLeftPanelOpen()}
    >
      <PanelLeftIcon className="size-4" isOpen={leftPanelOpen} />
    </button>
  );
}

function RightPanelToggleButton({ className }: { className?: string }) {
  const rightSidebarOpen = useStudioStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useStudioStore((s) => s.toggleRightSidebar);
  // Nothing to view/toggle on the home page — no connection means no JSON
  // viewer content, so disable rather than leave it clickable and inert.
  const view = useStudioStore((s) => s.view);
  const openLen = useStudioStore((s) => s.open.length);
  const on_home = view !== "workspace" || openLen === 0;
  return (
    <button
      type="button"
      disabled={on_home}
      aria-label={
        rightSidebarOpen ? "Hide the JSON viewer" : "Show the JSON viewer"
      }
      title={rightSidebarOpen ? "Hide the JSON viewer" : "Show the JSON viewer"}
      className={cn(
        className,
        "disabled:pointer-events-none disabled:opacity-40",
      )}
      onClick={() => toggleRightSidebar()}
    >
      <PanelRightIcon className="size-4" isOpen={rightSidebarOpen} />
    </button>
  );
}

const UPDATE_CALLOUT_AUTO_DISMISS_MS = 8000;

/** Only rendered once a background/on-demand check has actually found a
 *  newer release (`updateInfo`) that the user hasn't already dismissed via
 *  the dialog's "Skip" (`skippedUpdateVersion`) — a quiet affordance, not a
 *  permanent fixture, matching how `RightPanelToggleButton` also only
 *  shows real state rather than always occupying the slot.
 *
 *  Announces itself once per newly-seen version with a tooltip that opens
 *  on its own (not just on hover) — a small icon appearing in a title bar
 *  is easy to miss entirely, so the first time a given version shows up it
 *  gets a few seconds of an unmissable callout before falling back to a
 *  normal hover tooltip. */
function UpdateBadgeButton({ className }: { className?: string }) {
  const updateInfo = useStudioStore((s) => s.updateInfo);
  const skippedVersion = useStudioStore((s) => s.skippedUpdateVersion);
  const setUpdateDialogOpen = useStudioStore((s) => s.setUpdateDialogOpen);
  const [calloutOpen, setCalloutOpen] = useState(false);
  const announced_version = useRef<string | null>(null);

  useEffect(() => {
    if (!updateInfo || updateInfo.version === skippedVersion) return;
    if (announced_version.current === updateInfo.version) return;
    announced_version.current = updateInfo.version;
    setCalloutOpen(true);
    const t = setTimeout(
      () => setCalloutOpen(false),
      UPDATE_CALLOUT_AUTO_DISMISS_MS,
    );
    return () => clearTimeout(t);
  }, [updateInfo, skippedVersion]);

  if (!updateInfo || updateInfo.version === skippedVersion) return null;

  return (
    <TooltipProvider delay={300}>
      <Tooltip open={calloutOpen} onOpenChange={setCalloutOpen}>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={`Update available — v${updateInfo.version}`}
              className={cn(className, "text-primary")}
              onClick={() => {
                setCalloutOpen(false);
                setUpdateDialogOpen(true);
              }}
            >
              <ArrowUpCircle className="size-4" />
            </button>
          }
        />
        <TooltipContent side="bottom">
          Update available — v{updateInfo.version}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Center section of the title bar: the app title when no connection is
 *  open, or an outlined dropdown switcher between open connections
 *  otherwise — replaces the old workspace-level connection-tabs strip
 *  (connection-tabs.tsx, no longer mounted) so switching connections is
 *  reachable from the persistent title bar instead of a row that only
 *  existed inside an active workspace.
 *
 *  The disconnected/connected branches each own their `data-tauri-drag-
 *  region` placement rather than sharing one wrapping div: the region
 *  matches clicks via `closest()`, so putting the attribute on an ancestor
 *  of the dropdown's trigger button would swallow its clicks as a window-
 *  drag gesture instead (the exact issue the title bar's own section
 *  layout comment already calls out for the menu/toggle buttons). Flanking
 *  drag-region strips keep the rest of that space draggable. */
function ConnectionSwitcher() {
  const open = useStudioStore((s) => s.open);
  const activeId = useStudioStore((s) => s.activeId);
  const setActive = useStudioStore((s) => s.setActive);
  const [search, setSearch] = useState("");

  if (open.length === 0) {
    return (
      <div
        data-tauri-drag-region
        className="flex h-full flex-1 items-center justify-center"
      >
        <span className="text-muted-foreground text-xs font-medium">
          DH Studio
        </span>
      </div>
    );
  }

  const active = open.find((c) => c.id === activeId) ?? open[0];
  const ActiveIcon = DBIcons[active.kind];
  const filtered = open.filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full flex-1 items-center justify-center gap-1">
      <div data-tauri-drag-region className="h-full flex-1" />
      <DropdownMenu onOpenChange={(next) => !next && setSearch("")}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="hover:bg-muted flex max-w-64 min-w-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
            >
              {ActiveIcon && <ActiveIcon className="size-3.5 shrink-0" />}
              <span className="min-w-0 truncate">{active.name}</span>
              <ChevronDown className="size-3 shrink-0 opacity-60" />
            </button>
          }
        />
        <DropdownMenuContent align="center" className="w-56">
          {open.length > 1 && (
            // Not a DropdownMenuItem: typing a letter into a focused item
            // would trigger the menu's own typeahead jump instead of
            // reaching this field, so stop the keydown short of that
            // (Escape excepted, so it still closes the menu as usual).
            <div
              className="p-1"
              onKeyDown={(e) => {
                if (e.key !== "Escape") e.stopPropagation();
              }}
            >
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search connections…"
                className="text-xs"
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              No matching connections.
            </p>
          ) : (
            filtered.map((conn) => {
              const Icon = DBIcons[conn.kind];
              const is_active = conn.id === active.id;
              return (
                <DropdownMenuItem
                  key={conn.id}
                  onClick={() => setActive(conn.id)}
                  className={cn(
                    "flex items-center justify-between gap-2",
                    is_active && "bg-muted",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {Icon && <Icon className="size-3.5 shrink-0" />}
                    <span className="truncate">{conn.name}</span>
                  </span>
                  <DisconnectDbBtn conn={conn} />
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <div data-tauri-drag-region className="h-full flex-1" />
    </div>
  );
}

/** Section 1 (left, `w-24`) is reserved, empty space — the traffic lights
 *  render natively on top of it (`titleBarStyle: "overlay"`), nothing of
 *  ours goes there. Section 3 (right) is given the SAME width so section 2
 *  (the title) sits at the bar's true center, not just centered in
 *  whatever space happens to be left over. Sized for 3 buttons (was `w-20`/
 *  2 buttons before the update badge) — fixed regardless of whether the
 *  badge is currently showing, so the title doesn't visibly re-center the
 *  moment a background update check finds something. */
function MacTitleBar() {
  return (
    <div className="flex h-8 shrink-0 items-stretch border-b select-none">
      <div data-tauri-drag-region className="w-24 shrink-0" />
      <ConnectionSwitcher />
      <div className="flex w-24 shrink-0 items-center justify-center gap-1">
        <UpdateBadgeButton className="hover:bg-muted flex size-7 items-center justify-center rounded" />
        <LeftPanelToggleButton className="hover:bg-muted flex size-7 items-center justify-center rounded" />
        <RightPanelToggleButton className="hover:bg-muted flex size-7 items-center justify-center rounded" />
      </div>
    </div>
  );
}

/** Section 1 (left) is the menu — the same side Windows/Linux apps
 *  conventionally put one. Section 3 (right) is the sidebar/JSON toggles
 *  plus the window buttons, since that's where this OS puts those.
 *  Section 2 (the title) is only ever *roughly* centered here — section 1's
 *  width varies with menu label lengths and won't generally match section
 *  3's fixed width, and forcing them equal would either clip the menu or
 *  waste space on the right. Real apps (VS Code included) accept this same
 *  imperfect centering on Windows/Linux rather than fake it. */
function WindowsLinuxTitleBar() {
  const view = useStudioStore((s) => s.view);
  const openLen = useStudioStore((s) => s.open.length);
  const has_connection = view === "workspace" && openLen > 0;
  // NoSQL console only makes sense against a MongoDB connection — matches
  // the same `is_mongo` gate the tab-bar's "+" dropdown and command palette
  // already use (see command-palette-items.tsx / tab-bar.tsx).
  const is_mongo = useActiveConnection()?.kind === "mongodb";
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const initial = await win.isMaximized();
      if (cancelled) return;
      setMaximized(initial);
      unlisten = await win.onResized(async () => {
        if (!cancelled) setMaximized(await win.isMaximized());
      });
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const withWindow = (fn: (w: WindowApi) => Promise<void>) => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      fn(getCurrentWindow()),
    );
  };

  return (
    <div className="bg-background flex h-9 shrink-0 items-stretch border-b text-sm select-none">
      {/* Section 1 — menu */}
      <div className="flex items-center gap-0.5 px-1">
        {TITLE_BAR_MENUS.map((menu) => (
          <DropdownMenu key={menu.label}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="hover:bg-muted rounded px-2 py-1.5 text-xs font-medium outline-none"
                >
                  {menu.label}
                </button>
              }
            />
            <DropdownMenuContent align="start" className={"w-full"}>
              {menu.items.map((item, i) => {
                if ("separator" in item)
                  return <DropdownMenuSeparator key={i} />;
                const needs_mongo = item.id === "file.new_mongo_console";
                const disabled =
                  (item.requiresConnection && !has_connection) ||
                  (needs_mongo && !is_mongo);
                return (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={disabled}
                    title={
                      needs_mongo && has_connection && !is_mongo
                        ? "Only available for MongoDB connections"
                        : undefined
                    }
                    onClick={() => handleMenuAction(item.id)}
                  >
                    {item.label}
                    {item.accel && (
                      <DropdownMenuShortcut className="text-2xs">
                        {item.accel}
                      </DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>
      {/* Section 2 — centered title/connection switcher. See
       * ConnectionSwitcher's own doc comment for why it manages its
       * `data-tauri-drag-region` placement itself rather than sharing one
       * wrapping div the way this used to. */}
      <ConnectionSwitcher />
      {/* Section 3 — other toggles + window buttons (this OS's convention
       * for where those go). */}
      <div className="flex items-stretch">
        <UpdateBadgeButton className="hover:bg-muted flex w-11 items-center justify-center" />
        <LeftPanelToggleButton className="hover:bg-muted flex w-11 items-center justify-center" />
        <RightPanelToggleButton className="hover:bg-muted flex w-11 items-center justify-center" />
        <button
          type="button"
          aria-label="Minimize"
          className="hover:bg-muted flex w-11 items-center justify-center"
          onClick={() => withWindow((w) => w.minimize())}
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          className="hover:bg-muted flex w-11 items-center justify-center"
          onClick={() => withWindow((w) => w.toggleMaximize())}
          onMouseEnter={() => {
            // Windows 11 only: with decorations off there's no native
            // maximize caption button for the shell to hover-detect on its
            // own, so simulate its Win+Z shortcut to pop the real Snap
            // Layout flyout in the same spot (see `show_snap_overlay` in
            // src-tauri/src/commands.rs — a no-op on other platforms).
            if (!IS_WINDOWS) return;
            void import("@tauri-apps/api/core").then(({ invoke }) =>
              invoke("show_snap_overlay"),
            );
          }}
        >
          {maximized ? (
            <SquareStack className="size-3" />
          ) : (
            <Square className="size-3" />
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="hover:bg-destructive hover:text-destructive-foreground flex w-11 items-center justify-center"
          onClick={() => withWindow((w) => w.close())}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
