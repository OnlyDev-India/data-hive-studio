import {
  Code,
  History,
  SquarePlus,
  Table as TableIcon,
  Terminal,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { StudioTab } from "@/shared/store";
import MongoIcon from "@/shared/components/icons/mongo";

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
      return <TableIcon className={cn("size-3.5 text-sky-400", className)} />;
    // The self-colored official Mongo leaf, not the generic gray TableIcon —
    // a Mongo collection tab used to be visually identical to a SQL table
    // tab; this is the one place that tells them apart at a glance.
    case "mongo":
      return <MongoIcon className={cn("size-3.5", className)} />;
    case "sql":
      return <Code className={cn("size-3.5 text-emerald-400", className)} />;
    case "new-table":
      return (
        <SquarePlus className={cn("size-3.5 text-orange-400", className)} />
      );
    case "mongo-console":
      return <Terminal className={cn("size-3.5 text-sky-400", className)} />;
    case "activity":
      return (
        <History className={cn("text-muted-foreground size-3.5", className)} />
      );
  }
}
