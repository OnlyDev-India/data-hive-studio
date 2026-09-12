import { useState } from "react";
import {
  Check,
  ChevronDown,
  FileCode2,
  Loader2,
  Plus,
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
import { ApplyChangesDialog } from "@/shared/components/apply-changes-dialog";
import { useStudioStore, type GridBridge } from "@/shared/store";
import { pending_changes_to_diff, type PendingChange } from "./grid-context";

/** Row-edit controls for a grid — moved out of the global action bar. Drops
 *  straight into the pane's existing header row (left of its FilterBar),
 *  not a row of its own. */
export function GridActionBar({
  bridge,
  conn_id,
}: {
  bridge: GridBridge;
  conn_id: string;
}) {
  const [apply_changes, setApplyChanges] = useState<PendingChange[] | null>(
    null,
  );
  const openSql = useStudioStore((s) => s.openSql);
  return (
    <TooltipProvider delay={500}>
      <div className="flex shrink-0 items-center gap-1">
        {bridge.pending_exists && (
          <>
            <Button
              size="sm"
              className="h-6 rounded-r-none px-2 text-xs"
              disabled={bridge.loading}
              title="Review and apply the pending changes"
              onClick={() => setApplyChanges(bridge.get_pending_changes())}
            >
              {bridge.loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Review &amp; Apply
              {bridge.pending_count > 1 ? ` (${bridge.pending_count})` : ""}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="iconXs"
                    disabled={bridge.loading}
                    aria-label="Pending edits options"
                    title="Pending edits options"
                    className="-ml-0.5 rounded-l-none"
                  />
                }
              >
                <ChevronDown className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => bridge.apply_pending()}
                  disabled={bridge.loading}
                >
                  <Check className="size-3.5" />
                  Apply
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const sql = bridge.get_pending_sql();
                    if (sql) openSql(conn_id, sql);
                  }}
                >
                  <FileCode2 className="size-3.5" />
                  Copy to SQL
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <GridToolbarButton
              icon={RotateCcw}
              label="Undo"
              title="Undo all changes"
              disabled={bridge.loading}
              onClick={() => bridge.cancel_pending()}
            />
          </>
        )}
        {bridge.has_full_row && (
          <GridToolbarButton
            icon={Trash2}
            label="Delete Row(s)"
            title={`Delete selected rows (${bridge.selected_count})`}
            disabled={!bridge.editable}
            onClick={() => bridge.delete_rows()}
            className="text-destructive/70 bg-destructive/10 hover:text-destructive hover:bg-destructive/20 border-destructive/70 border"
          />
        )}
        <GridToolbarButton
          icon={Plus}
          label="Add Row"
          title="Add a new row"
          disabled={!bridge.editable}
          onClick={() => bridge.start_pending()}
        />
        <GridToolbarButton
          icon={RefreshCw}
          label="Refresh"
          disabled={bridge.loading}
          onClick={() => bridge.refresh()}
          iconClassName={bridge.loading ? "animate-spin" : undefined}
          isIcon
        />
      </div>
      {apply_changes && (
        <ApplyChangesDialog
          changes={pending_changes_to_diff(apply_changes)}
          selectable
          on_apply={(keepIds) => bridge.apply_pending(keepIds)}
          on_close={() => setApplyChanges(null)}
        />
      )}
    </TooltipProvider>
  );
}

function GridToolbarButton({
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
            className={cn({ "text-2xs h-6 px-1.5 py-1": !isIcon }, className)}
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
