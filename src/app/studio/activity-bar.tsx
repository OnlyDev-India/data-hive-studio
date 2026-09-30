import { useState } from "react";
import {
  Ellipsis,
  History,
  Pin,
  PinOff,
  Settings,
  Terminal,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { SettingsDialog } from "@/features/settings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { DatabaseIcon, HouseIcon } from "@/shared/components/icons";
import { SquarePlusIcon } from "@/shared/components/icons/pluse-square";
import { useStudioStore } from "@/shared/store";
import { TOOLS, type Tool } from "./tools";

const BAR_BUTTON_CLASS = "group hover:bg-primary/20";
const DISABLED_CLASS =
  "opacity-40 hover:cursor-not-allowed hover:bg-transparent active:bg-transparent";

function BarButton({
  active,
  label,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // Guard in the handler too: never rely solely on the DOM disabled flag
  // surviving Base UI's render-prop composition chain.
  const safeOnClick = () => {
    if (!disabled) onClick();
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-disabled={disabled || undefined}
            onClick={safeOnClick}
            disabled={disabled}
            className={cn(
              BAR_BUTTON_CLASS,
              active ? "bg-primary/15 text-primary" : "text-muted-foreground",
              disabled && DISABLED_CLASS,
            )}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** A tool pinned onto the bar; right click unpins it. */
function PinnedToolButton({
  tool,
  disabled,
  on_run,
}: {
  tool: Tool;
  disabled: boolean;
  on_run: () => void;
}) {
  const setToolPinned = useStudioStore((s) => s.setToolPinned);
  const Icon = tool.icon;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div>
            <BarButton
              active={false}
              disabled={disabled}
              label={tool.label}
              onClick={on_run}
            >
              <Icon
                className={cn("size-5", {
                  "group-hover:text-primary": !disabled,
                })}
              />
            </BarButton>
          </div>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => setToolPinned(tool.id, false)}>
          <PinOff className="text-muted-foreground size-4" />
          Unpin
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Tools not pinned to the bar. Each item pins on hover. */
function ToolsMenu({
  tools,
  disabled,
  on_run,
}: {
  tools: Tool[];
  disabled: boolean;
  on_run: (tool: Tool) => void;
}) {
  const setToolPinned = useStudioStore((s) => s.setToolPinned);
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More tools"
                  className={cn(BAR_BUTTON_CLASS, "text-muted-foreground")}
                />
              }
            />
          }
        >
          <Ellipsis className="group-hover:text-primary size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">More tools</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="right" align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Tools</DropdownMenuLabel>
          {tools.map((tool) => {
            const Icon = tool.icon;
            return (
              <DropdownMenuItem
                key={tool.id}
                disabled={disabled}
                onClick={() => on_run(tool)}
                className="group/tool"
              >
                <Icon className="text-muted-foreground size-4" />
                <span className="flex-1">{tool.label}</span>
                <button
                  type="button"
                  aria-label={`Pin ${tool.label} to the bar`}
                  title="Pin to the bar"
                  className="text-muted-foreground hover:text-foreground rounded-inset pointer-events-auto p-0.5 opacity-0 group-hover/tool:opacity-100 focus-visible:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setToolPinned(tool.id, true);
                  }}
                >
                  <Pin className="size-3.5" />
                </button>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        {disabled && (
          <p className="text-muted-foreground text-caption px-1.5 py-1">
            Open a connection to use these.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ActivityBarProps {
  home_active: boolean;
  tables_active: boolean;
  activity_active: boolean;
  /** No connection open: connection-bound actions are disabled. */
  actions_disabled?: boolean;
  /** The workspace connection tools open into. */
  conn_id?: string;
  on_home: () => void;
  on_tables: () => void;
  on_new_table: () => void;
  on_sql: () => void;
  on_activity: () => void;
}

export function ActivityBar({
  home_active,
  tables_active,
  activity_active,
  actions_disabled = false,
  conn_id,
  on_home,
  on_tables,
  on_new_table,
  on_sql,
  on_activity,
}: ActivityBarProps) {
  // App settings dialog (gear button at the bottom of the bar).
  const [settings_open, set_settings_open] = useState(false);
  const pinnedTools = useStudioStore((s) => s.pinnedTools);
  const pinned = pinnedTools
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter((t): t is Tool => !!t);
  const unpinned = TOOLS.filter((t) => !pinnedTools.includes(t.id));
  const tools_disabled = actions_disabled || !conn_id;
  const run_tool = (tool: Tool) => {
    if (conn_id && !tools_disabled) tool.run(conn_id);
  };

  return (
    <TooltipProvider delay={0}>
      <nav className="bg-muted/60 flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3">
        <BarButton active={home_active} label="Home" onClick={on_home}>
          <HouseIcon className="size-5" active={home_active} />
        </BarButton>
        <BarButton
          active={tables_active}
          disabled={actions_disabled}
          label="Tables"
          onClick={on_tables}
        >
          <DatabaseIcon
            className="size-5"
            active={tables_active}
            disabled={actions_disabled}
          />
        </BarButton>
        <BarButton
          active={false}
          disabled={actions_disabled}
          label="New table"
          onClick={on_new_table}
        >
          <SquarePlusIcon
            className="size-5"
            active={false}
            disabled={actions_disabled}
          />
        </BarButton>
        <BarButton
          active={false}
          disabled={actions_disabled}
          label="SQL editor"
          onClick={on_sql}
        >
          <Terminal
            className={cn("size-5", {
              "group-hover:text-primary": !actions_disabled,
            })}
          />
        </BarButton>
        <BarButton
          active={activity_active}
          disabled={actions_disabled}
          label="Activity — backend command log"
          onClick={on_activity}
        >
          <History
            className={cn("size-5", {
              "group-hover:text-primary": !actions_disabled,
            })}
          />
        </BarButton>
        <div role="separator" className="bg-border my-1 h-px w-6" />
        {pinned.map((tool) => (
          <PinnedToolButton
            key={tool.id}
            tool={tool}
            disabled={tools_disabled}
            on_run={() => run_tool(tool)}
          />
        ))}
        {unpinned.length > 0 && (
          <ToolsMenu
            tools={unpinned}
            disabled={tools_disabled}
            on_run={run_tool}
          />
        )}
        <div className="mt-auto flex flex-col items-center gap-1">
          <BarButton
            active={false}
            label="Settings"
            onClick={() => set_settings_open(true)}
          >
            <Settings className="size-5" />
          </BarButton>
        </div>
        <SettingsDialog open={settings_open} onOpenChange={set_settings_open} />
      </nav>
    </TooltipProvider>
  );
}
