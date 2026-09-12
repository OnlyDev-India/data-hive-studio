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

/** Schema-mode controls for a table/collection pane — moved out of the
 *  global action bar, same as GridActionBar for the data-mode ones. */
export function SchemaActionBar({
  schemaEdit,
  schemaPane,
  drop_label,
}: {
  schemaEdit: SchemaEditHandle | null;
  schemaPane: SchemaPaneHandle | null;
  drop_label: string;
}) {
  return (
    <TooltipProvider delay={500}>
      <div className="flex shrink-0 items-center gap-1">
        {schemaEdit && (
          <>
            <span className="text-muted-foreground/80 shrink-0 text-xs">
              {schemaEdit.busy
                ? "Applying…"
                : `${schemaEdit.count} schema change${schemaEdit.count === 1 ? "" : "s"}`}
            </span>
            <Button
              size="sm"
              className="h-6 rounded-r-none px-2 text-xs"
              disabled={schemaEdit.busy || schemaEdit.count === 0}
              title="Review and apply the pending schema changes"
              onClick={() => schemaEdit.review()}
            >
              {schemaEdit.busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {schemaEdit.busy
                ? "Applying…"
                : `Review & Apply${schemaEdit.count > 1 ? ` (${schemaEdit.count})` : ""}`}
            </Button>
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
            />
            <SchemaToolbarButton
              icon={RefreshCw}
              label="Refresh schema"
              disabled={schemaPane.busy}
              onClick={() => schemaPane.refresh()}
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
}: {
  icon: LucideIcon;
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
  isIcon?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={isIcon ? "iconXs" : "default"}
            disabled={disabled}
            aria-label={label}
            title={title ?? label}
            onClick={onClick}
            className={cn({ "text-2xs h-6 p-1": !isIcon }, className)}
          >
            <Icon className={cn("size-3.5", iconClassName)} />
            {!isIcon && label}
          </Button>
        }
      />
      <TooltipContent side="top" className={"z-10!"}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
