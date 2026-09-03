import { TriangleAlert } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";

/** Shown on hover over the Data tab's warning icon. */
const NO_PK_WARNING =
  "No primary key — edits and deletes are applied by matching the row's full original contents, so identical duplicate rows are affected together.";

/** Data | Schema switcher shown in the table pane header. */
export function ModeTabs({
  mode,
  warn_no_pk = false,
  on_change,
}: {
  mode: "data" | "schema";
  /** Table has no primary key — flag it on the Data tab (hover for details). */
  warn_no_pk?: boolean;
  on_change: (mode: "data" | "schema") => void;
}) {
  return (
    <TooltipProvider delay={300}>
      <ModeButton
        active={mode === "data"}
        label="Data"
        warning={warn_no_pk}
        onClick={() => on_change("data")}
      />
      <ModeButton
        active={mode === "schema"}
        label="Schema"
        onClick={() => on_change("schema")}
      />
    </TooltipProvider>
  );
}

function ModeButton({
  active,
  label,
  warning = false,
  onClick,
}: {
  active: boolean;
  label: string;
  warning?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-auto rounded-none border-b-2 px-2 py-1.5 font-medium",
        active
          ? "border-primary text-primary"
          : "text-muted-foreground hover:text-foreground border-transparent",
      )}
    >
      {label}
      {warning && (
        // Base UI merges its listeners and positioning ref into `render`, so
        // the trigger needs a real element (a Fragment would swallow both).
        <Tooltip>
          <TooltipTrigger render={<span className="ml-1 inline-flex" />}>
            <TriangleAlert
              className="text-warning size-3.5"
              aria-label="No primary key"
            />
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="bg-warning/10 text-warning border-warning max-w-xs border text-left backdrop-blur-lg"
          >
            {NO_PK_WARNING}
          </TooltipContent>
        </Tooltip>
      )}
    </Button>
  );
}
