import { cn } from "@/shared/lib/utils";
import type { ConnectionInfo } from "@/shared/api";
import { Button } from "@/shared/components/ui";
import DisconnectDbBtn from "@/shared/components/disconnect-db-btn";
import { DBIcons } from "@/shared/components/icons/types";

interface ConnectionTabsProps {
  conns: ConnectionInfo[];
  active_id: string | null;
  on_switch: (id: string) => void;
}

/** Connection tabs only — the sidebar/JSON-viewer toggle buttons that used
 *  to live here moved to the title bar (title-bar.tsx), which now exists on
 *  every platform and is the more natural home for window-chrome-level
 *  toggles than a row that's specifically about switching connections. */
export function ConnectionTabs({
  conns,
  active_id,
  on_switch,
}: ConnectionTabsProps) {
  return (
    <div className="bg-background flex items-end gap-1 overflow-x-auto border-b px-2 pt-1.5">
      {conns.map((conn) => {
        const active = conn.id === active_id;
        const DBIcon = DBIcons[conn.kind];
        return (
          <div key={conn.id} className="relative flex items-center">
            <Button
              variant="ghost"
              onClick={() => on_switch(conn.id)}
              className={cn(
                "max-w-48 shrink-0 rounded-b-none border border-b-0 px-3 py-1.5 font-normal",
                active
                  ? "border-border bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
              )}
            >
              {DBIcon && <DBIcon className="size-4" />}
              <span className="truncate">{conn.name}</span>
              <DisconnectDbBtn conn={conn} />
            </Button>
          </div>
        );
      })}
    </div>
  );
}
