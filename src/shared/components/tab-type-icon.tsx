import { Code, History, SquarePlus, Table as TableIcon, Terminal } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { StudioTab } from "@/shared/store";

/** Icon for a workspace tab kind — used by the tab strip and the status bar. */
export function TabTypeIcon({
  tab,
  className,
}: {
  tab: StudioTab;
  className?: string;
}) {
  switch (tab.kind) {
    case "table":
    case "mongo":
      return (
        <TableIcon
          className={cn("text-muted-foreground size-3.5", className)}
        />
      );
    case "sql":
      return (
        <Code className={cn("text-muted-foreground size-3.5", className)} />
      );
    case "new-table":
      return (
        <SquarePlus
          className={cn("text-muted-foreground size-3.5", className)}
        />
      );
    case "mongo-console":
      return (
        <Terminal
          className={cn("text-muted-foreground size-3.5", className)}
        />
      );
    case "activity":
      return (
        <History className={cn("text-muted-foreground size-3.5", className)} />
      );
  }
}
