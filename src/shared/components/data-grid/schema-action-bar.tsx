import {
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
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
import { Fragment, type ReactNode, type RefObject } from "react";

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
  type ButtonFactory = (props: { compact: boolean }) => ReactNode;
  const buttons: ButtonFactory[] = [
    (props) => (
      <SchemaToolbarButton
        icon={Trash2}
        label={drop_label}
        disabled={!schemaPane || schemaPane?.busy}
        onClick={() => schemaPane?.drop()}
        className="text-destructive/70 bg-destructive/10 hover:text-destructive hover:bg-destructive/20"
        {...props}
      />
    ),
    (props) => (
      <SchemaToolbarButton
        icon={RefreshCw}
        label="Refresh schema"
        disabled={!schemaPane || schemaPane?.busy}
        onClick={() => schemaPane?.refresh()}
        {...props}
      />
    ),
    (props) => (
      <SchemaToolbarButton
        icon={RotateCcw}
        label="Undo"
        disabled={!schemaEdit || schemaEdit?.busy}
        onClick={() => schemaEdit?.discard()}
        {...props}
      />
    ),
    (props) => (
      <>
        <SchemaToolbarButton
          icon={schemaEdit?.busy ? Loader2 : Check}
          label={`Review${schemaEdit?.count && schemaEdit?.count > 1 ? ` (${schemaEdit?.count})` : ""}`}
          className={cn("bg-primary hover:bg-primary/70 rounded-r-none")}
          iconClassName={
            schemaEdit?.busy ? "size-3.5 animate-spin" : "size-3.5"
          }
          disabled={!schemaEdit || schemaEdit?.busy || schemaEdit?.count === 0}
          onClick={() => schemaEdit?.review()}
          {...props}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="iconXs"
                disabled={
                  !schemaEdit || schemaEdit?.busy || schemaEdit?.count === 0
                }
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
              onClick={() => schemaEdit?.apply()}
              disabled={schemaEdit?.busy}
            >
              <Check className="size-3.5" />
              Apply
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    ),
  ];
  const compact = usePaneCompactWidth(pane_ref, buttons.length);

  return (
    <TooltipProvider delay={500}>
      <div className="flex min-w-0 flex-1 shrink-0 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-1" />
        {buttons.map((btn, idx) => (
          <Fragment key={idx}>
            {btn({ compact: compact[idx] })}
            {idx === 1 && <div className="bg-border mx-1 h-4 w-px" />}
          </Fragment>
        ))}
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
