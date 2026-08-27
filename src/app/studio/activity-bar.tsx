import {
  Database,
  History,
  House,
  ShieldCheck,
  SquarePlus,
  Terminal,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { useStudioStore } from "@/shared/store";
import { ServerMenu } from "@/features/sharing";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

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
              active ? "bg-primary/15 text-primary" : "text-muted-foreground",
              disabled &&
                "opacity-40 hover:cursor-not-allowed hover:bg-transparent active:bg-transparent",
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

interface ActivityBarProps {
  home_active: boolean;
  tables_active: boolean;
  activity_active: boolean;
  /** No connection open: connection-bound actions are disabled. */
  actions_disabled?: boolean;
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
  on_home,
  on_tables,
  on_new_table,
  on_sql,
  on_activity,
}: ActivityBarProps) {
  // Team-admin entry: appears only while a connected server session carries
  // admin scope. Reads the store directly so both landing and workspace
  // instances stay in sync.
  const admin_visible = useStudioStore((s) =>
    Object.values(s.serverSessions).some((sess) => sess.me.is_admin),
  );
  const admin_active = useStudioStore((s) => s.view === "admin");
  const setView = useStudioStore((s) => s.setView);

  return (
    <TooltipProvider delay={0}>
      <nav className="bg-background flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3">
        <BarButton active={home_active} label="Home" onClick={on_home}>
          <House className="size-5" />
        </BarButton>
        <BarButton
          active={tables_active}
          disabled={actions_disabled}
          label="Tables"
          onClick={on_tables}
        >
          <Database className="size-5" />
        </BarButton>
        <BarButton
          active={false}
          disabled={actions_disabled}
          label="New table"
          onClick={on_new_table}
        >
          <SquarePlus className="size-5" />
        </BarButton>
        <BarButton
          active={false}
          disabled={actions_disabled}
          label="SQL editor"
          onClick={on_sql}
        >
          <Terminal className="size-5" />
        </BarButton>
        <BarButton
          active={activity_active}
          disabled={actions_disabled}
          label="Activity — backend command log"
          onClick={on_activity}
        >
          <History className="size-5" />
        </BarButton>
        <div className="mt-auto flex flex-col items-center gap-1">
          <ServerMenu />
          {admin_visible && (
            <BarButton
              active={admin_active}
              label="Team admin — devices, invites, grants"
              onClick={() => setView(admin_active ? "home" : "admin")}
            >
              <ShieldCheck className="size-5" />
            </BarButton>
          )}
          <ThemeToggle />
        </div>
      </nav>
    </TooltipProvider>
  );
}
