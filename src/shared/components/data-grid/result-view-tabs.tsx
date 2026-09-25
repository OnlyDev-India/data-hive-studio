import type { ReactNode } from "react";
import { CodeXml, Info, Table2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

/** A VIEW of one already-selected query result — not to be confused with
 *  `ResultTabStrip` (editor-tab.tsx), which picks WHICH statement's result
 *  is selected in the first place. This switches how that one result is
 *  displayed. */
export type ResultView = "result" | "summary" | "query";

const TABS: { id: ResultView; label: string; icon: ReactNode }[] = [
  { id: "result", label: "Result", icon: <Table2 className="size-3.5" /> },
  { id: "summary", label: "Summary", icon: <Info className="size-3.5" /> },
  { id: "query", label: "Query", icon: <CodeXml className="size-3.5" /> },
];

/** Result | Summary | Query switcher shown in a query result's own header —
 *  same structural role/position as `ModeTabs` in the table pane's header
 *  (a left-aligned view switcher), just inline buttons instead of a
 *  dropdown since there are only ever these three, always-visible options. */
export function ResultViewTabs({
  active,
  on_change,
}: {
  active: ResultView;
  on_change: (tab: ResultView) => void;
}) {
  return (
    <TooltipProvider delay={0}>
      <div className="flex items-center gap-0.5">
        {TABS.map((t) => {
          const selected = active === t.id;
          const button = (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 gap-1 px-2 text-xs",
                selected && "bg-muted text-foreground",
              )}
              aria-label={t.label}
              onClick={() => on_change(t.id)}
            >
              {t.icon}
              {selected && t.label}
            </Button>
          );
          // The selected tab already shows its name, so only the icon only
          // ones need a tooltip.
          return selected ? (
            <span key={t.id}>{button}</span>
          ) : (
            <Tooltip key={t.id}>
              <TooltipTrigger render={button} />
              <TooltipContent side="top">{t.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
