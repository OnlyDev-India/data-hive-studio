import { useEffect, useState } from "react";
import { Minus, Square, SquareStack, X } from "lucide-react";
import { WEB } from "@/shared/api/web";
import { cn } from "@/shared/lib/utils";
import { useActiveConnection, useStudioStore } from "@/shared/store";
import PanelLeftIcon from "@/shared/components/icons/panel-left";
import PanelRightIcon from "@/shared/components/icons/panel-right";
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

const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
const IS_WINDOWS =
  typeof navigator !== "undefined" && /win/i.test(navigator.userAgent);

/** Every desktop platform gets a custom top bar now (matches VS Code on all
 *  three), always three sections: whichever side the OS puts its own
 *  window buttons on (left for macOS traffic lights, right for
 *  Windows/Linux) also holds the menu (Windows/Linux) or is otherwise
 *  reserved space (macOS); the opposite/remaining side holds the other
 *  buttons (sidebar + JSON panel toggles); the middle is always the
 *  centered app title. Both toggle buttons used to live in
 *  `connection-tabs.tsx` — moved here since a title bar now exists on
 *  every platform and connection-tabs.tsx is tabs-only now. */
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
      aria-label={leftPanelOpen ? "Hide the left sidebar" : "Show the left sidebar"}
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
      aria-label={rightSidebarOpen ? "Hide the JSON viewer" : "Show the JSON viewer"}
      title={rightSidebarOpen ? "Hide the JSON viewer" : "Show the JSON viewer"}
      className={cn(className, "disabled:pointer-events-none disabled:opacity-40")}
      onClick={() => toggleRightSidebar()}
    >
      <PanelRightIcon className="size-4" isOpen={rightSidebarOpen} />
    </button>
  );
}

/** Section 1 (left, `w-20`) is reserved, empty space — the traffic lights
 *  render natively on top of it (`titleBarStyle: "overlay"`), nothing of
 *  ours goes there. Section 3 (right) is given the SAME width so section 2
 *  (the title) sits at the bar's true center, not just centered in
 *  whatever space happens to be left over. */
function MacTitleBar() {
  return (
    <div className="flex h-8 shrink-0 items-stretch border-b select-none">
      <div data-tauri-drag-region className="w-20 shrink-0" />
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center justify-center"
      >
        <span className="text-muted-foreground text-xs font-medium">
          DH Studio
        </span>
      </div>
      <div className="flex w-20 shrink-0 items-center justify-center gap-1">
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
                if ("separator" in item) return <DropdownMenuSeparator key={i} />;
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
                      <DropdownMenuShortcut>{item.accel}</DropdownMenuShortcut>
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>
      {/* Section 2 — centered title. It's the only drag region: putting
       * that attribute on the outer bar too would let Tauri's drag
       * detection (which matches via `closest()`) intercept clicks meant
       * for the menu/toggle/window buttons on either side of it. */}
      <div
        data-tauri-drag-region
        className="flex flex-1 items-center justify-center"
      >
        <span className="text-muted-foreground text-xs font-medium">
          DH Studio
        </span>
      </div>
      {/* Section 3 — other toggles + window buttons (this OS's convention
       * for where those go). */}
      <div className="flex items-stretch">
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
