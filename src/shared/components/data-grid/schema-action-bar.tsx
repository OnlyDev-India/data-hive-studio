import {
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import type { SchemaEditHandle, SchemaPaneHandle } from "@/shared/store";
import { usePaneCompactWidth } from "./grid-action-bar";
import type { RefObject } from "react";

/** Schema-mode controls for a table/collection pane — moved out of the
 *  global action bar, same as GridActionBar for the data-mode ones.
 *  `compact` collapses labeled buttons to icon-only, same as
 *  GridActionBar's own — MUST be measured from the owning pane's width
 *  (`usePaneCompactWidth` in `grid-action-bar.tsx`), not this bar's own
 *  rendered width, for the same reason documented there. */
export function SchemaActionBar({
  schemaEdit,
  schemaPane,
  drop_label,
  pane_ref,
}: {
  schemaEdit: SchemaEditHandle | null;
  schemaPane: SchemaPaneHandle | null;
  drop_label: string;
  pane_ref: RefObject<HTMLDivElement | null>;
}) {
  const compact = usePaneCompactWidth(pane_ref, 3);

  return (
    <TooltipProvider delay={500}>
      <div className="flex shrink-0 items-center gap-1">
        {schemaEdit && (
          <>
            {!compact && (
              <span className="text-muted-foreground/80 shrink-0 text-xs">
                {schemaEdit.busy
                  ? "Applying…"
                  : `${schemaEdit.count} schema change${schemaEdit.count === 1 ? "" : "s"}`}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger
                disabled={!compact}
                render={
                  <Button
                    size={compact ? "iconXs" : "sm"}
                    className={cn(
                      "rounded-r-none",
                      compact ? "" : "h-6 px-2 text-xs",
                    )}
                    disabled={schemaEdit.busy || schemaEdit.count === 0}
                    aria-label="Review and apply the pending schema changes"
                    onClick={() => schemaEdit.review()}
                  >
                    {schemaEdit.busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    {!compact &&
                      (schemaEdit.busy
                        ? "Applying…"
                        : `Review & Apply${schemaEdit.count > 1 ? ` (${schemaEdit.count})` : ""}`)}
                  </Button>
                }
              />
              <TooltipContent side="top" className="z-10!">
                Review and apply the pending schema changes
                {schemaEdit.count > 1 ? ` (${schemaEdit.count})` : ""}
              </TooltipContent>
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="iconXs"
                    disabled={schemaEdit.busy || schemaEdit.count === 0}
                    aria-label="Pending schema changes options"
                    title="Pending schema changes options"
                    className="-ml-0.5 rounded-l-none"
                  />
                }
              >
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onClick={() => schemaEdit.apply()}
                  disabled={schemaEdit.busy}
                >
                  <Check className="size-3.5" />
                  Apply
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <SchemaToolbarButton
              icon={X}
              label="Discard schema changes"
              disabled={schemaEdit.busy}
              onClick={() => schemaEdit.discard()}
              compact={compact[0]}
            />
          </>
        )}
        {schemaPane && (
          <>
            <SchemaToolbarButton
              icon={Trash2}
              label={drop_label}
              disabled={schemaPane.busy}
              onClick={() => schemaPane.drop()}
              className="text-destructive/70 bg-destructive/10 hover:text-destructive hover:bg-destructive/20"
              compact={compact[1]}
            />
            <SchemaToolbarButton
              icon={RefreshCw}
              label="Refresh schema"
              disabled={schemaPane.busy}
              onClick={() => schemaPane.refresh()}
              compact={compact[2]}
            />
          </>
        )}
      </div>
    </TooltipProvider>
  );
}

function SchemaToolbarButton({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  className,
  iconClassName,
  isIcon,
  compact,
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
  isIcon?: boolean;
  /** Collapses a labeled button to icon-only, same as `isIcon`, but driven
   *  by the toolbar's own measured width instead of being permanent. */
  compact?: boolean;
}) {
  const icon_only = isIcon || compact;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={icon_only ? "iconXs" : "default"}
            disabled={disabled}
            aria-label={label}
            title={title ?? label}
            onClick={onClick}
            className={cn({ "text-2xs h-6 p-1": !icon_only }, className)}
          >
            <Icon className={cn("size-3.5", iconClassName)} />
            {!icon_only && label}
          </Button>
        }
      />
      <TooltipContent side="top" className={"z-10!"}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
