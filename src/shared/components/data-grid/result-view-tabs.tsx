import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

/** A VIEW of one already-selected query result — not to be confused with
 *  `ResultTabStrip` (editor-tab.tsx), which picks WHICH statement's result
 *  is selected in the first place. This switches how that one result is
 *  displayed. */
export type ResultView = "result" | "summary" | "query";

const TABS: { id: ResultView; label: string }[] = [
  { id: "result", label: "Result" },
  { id: "summary", label: "Summary" },
  { id: "query", label: "Query" },
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
    <div className="flex items-center gap-0.5">
      {TABS.map((t) => (
        <Button
          key={t.id}
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-6 px-2 text-xs",
            active === t.id && "bg-muted text-foreground",
          )}
          onClick={() => on_change(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}
