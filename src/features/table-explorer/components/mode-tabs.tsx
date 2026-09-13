import { ChevronDown, Form, Sheet, TriangleAlert } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui";
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
      {warn_no_pk && (
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
            showArrow={false}
          >
            {NO_PK_WARNING}
          </TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={"secondary"}
              size="sm"
              aria-label="Pending edits options"
              title="Pending edits options"
              className=""
            />
          }
        >
          {mode}
          <ChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => on_change("data")}
            className={cn({ "bg-muted/70": mode === "data" })}
          >
            <Sheet />
            Data
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => on_change("schema")}
            className={cn({ "bg-muted/70": mode === "schema" })}
          >
            <Form />
            Schema
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
