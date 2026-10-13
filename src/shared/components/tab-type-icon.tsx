import {
  Code,
  GitCompareArrows,
  History,
  Network,
  SquarePlus,
  Table as TableIcon,
  Terminal,
  Workflow,
  Blocks,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { StudioTab } from "@/shared/store";
import MongoIcon from "@/shared/components/icons/mongo";
import { TAB_ICON_CLASS } from "@/shared/components/icons/types";

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
      return (
        <TableIcon
          className={cn("size-3.5", TAB_ICON_CLASS.table, className)}
        />
      );
    // The self-colored official Mongo leaf, not the generic gray TableIcon —
    // a Mongo collection tab used to be visually identical to a SQL table
    // tab; this is the one place that tells them apart at a glance.
    case "mongo":
      return <MongoIcon className={cn("size-3.5", className)} />;
    case "sql":
      return <Code className={cn("size-3.5", TAB_ICON_CLASS.sql, className)} />;
    case "new-table":
      return (
        <SquarePlus
          className={cn("size-3.5", TAB_ICON_CLASS["new-table"], className)}
        />
      );
    case "mongo-console":
      return (
        <Terminal
          className={cn("size-3.5", TAB_ICON_CLASS["mongo-console"], className)}
        />
      );
    case "activity":
      return (
        <History className={cn("text-muted-foreground size-3.5", className)} />
      );
    case "compare":
      return (
        <GitCompareArrows
          className={cn("size-3.5", TAB_ICON_CLASS.compare, className)}
        />
      );
    case "aggregation":
      return (
        <Workflow
          className={cn("size-3.5", TAB_ICON_CLASS.aggregation, className)}
        />
      );
    case "query-builder":
      return (
        <Blocks
          className={cn("size-3.5", TAB_ICON_CLASS["query-builder"], className)}
        />
      );
    case "relation-diagram":
      return (
        <Network
          className={cn(
            "size-3.5",
            TAB_ICON_CLASS["relation-diagram"],
            className,
          )}
        />
      );
  }
}
