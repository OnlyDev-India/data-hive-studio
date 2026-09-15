import { useEffect, useState, type RefObject } from "react";
import {
  Check,
  ChevronDown,
  FileCode2,
  Loader2,
  Pencil,
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
import { FilterBar, type FilterBarProps } from "./filter-bar";
import { BulkEditDialog } from "./bulk-edit-dialog";
import type { FilterColumn } from "./filter-condition-builder";
import type { DistinctMap } from "./types";

// ponytail: one fixed pixel threshold for the whole PANE (not just this bar)
// rather than a per-button collapse order (dbx's
// dataGridToolbarActionCollapseCount) — good enough since this bar has at
// most 5 labeled controls; revisit with a real collapse order if it ever
// grows past that. Deliberately not calibrated against this bar's OWN
// rendered width (see `usePaneCompactWidth`'s doc comment for why that's
// the wrong measurement) — this is "how wide is the whole pane," so it
// needs to be bigger than just the toolbar's own content would.
const PANE_COMPACT_BELOW_PX = 820;
const ONE_BUTTON_MIN_SHRINK = 30;

/** Watches `ref`'s element (the owning PANE, not this toolbar itself — see
 *  `GridActionBar`'s own doc comment) and reports whether it's narrower
 *  than `PANE_COMPACT_BELOW_PX`. Shared by `TablePane` and
 *  `MongoCollectionPane`, each of which owns the ref on its own root
 *  element and passes the result down as `GridActionBar`'s `compact` prop. */
export function usePaneCompactWidth(
  ref: RefObject<HTMLElement | null>,
  noOfElements: number,
) {
  const [compact, setCompact] = useState(Array(noOfElements).fill(false));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry)
        setCompact((prev) => {
          // entry.contentRect.width < PANE_COMPACT_BELOW_PX;
          const new_compact = prev.map(
            (_, index) =>
              entry.contentRect.width <
              PANE_COMPACT_BELOW_PX - index * ONE_BUTTON_MIN_SHRINK,
          );
          return new_compact;
        });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return compact;
}

/** Row-edit controls for a grid, plus the FilterBar (`WHERE ⌄`) at the end
 *  of the same row — moved out of the global action bar, not a row of its
 *  own. `filter_bar` absent hides just the filter control (e.g. schema
 *  still loading) independent of whether the rest of the bar shows.
 *  `compact` collapses labeled buttons to icon-only (with their tooltip
 *  taking over as the label); it MUST be measured from the owning pane's
 *  own width (`usePaneCompactWidth`), not this bar's own rendered width —
 *  collapsing shrinks this bar's content, which would otherwise
 *  permanently confirm "too narrow" the instant it collapses once, even at
 *  a wide window, since there'd be nothing left to ever measure the wider,
 *  uncollapsed width again. */
export function GridActionBar({
  bridge,
  conn_id,
  pane_ref,
  filter_bar,
  bulk_edit,
}: {
  bridge: GridBridge;
  conn_id: string;
  pane_ref: RefObject<HTMLDivElement | null>;
  filter_bar?: FilterBarProps;
  /** Absent hides the Bulk Edit button (e.g. schema still loading) —
   *  `columns`/`distinct` mirror `filter_bar`'s own (the pane already has
   *  them for the WHERE filter, no separate fetch needed). */
  bulk_edit?: { columns: FilterColumn[]; distinct: DistinctMap };
}) {
  const [apply_changes, setApplyChanges] = useState<PendingChange[] | null>(
    null,
  );
  const [bulk_edit_open, setBulkEditOpen] = useState(false);
  const openSql = useStudioStore((s) => s.openSql);
  const compact = usePaneCompactWidth(pane_ref, 6);

  return (
    <TooltipProvider delay={500}>
      <div className="flex min-w-0 flex-1 shrink-0 items-center gap-1">
        <div className="bg-border mx-1 h-4 w-px" />

        {filter_bar && <FilterBar {...filter_bar} />}

        <div className="bg-border mx-1 h-4 w-px" />
        {/* Icon cluster first, then add/delete, then the pending-changes
         *  commit group last — same left-to-right rhythm as a typical
         *  DB-client grid toolbar (icons, row actions, commit/rollback). */}
        <GridToolbarButton
          icon={RefreshCw}
          label="Refresh"
          disabled={bridge.loading}
          onClick={() => bridge.refresh()}
          iconClassName={bridge.loading ? "animate-spin" : undefined}
          compact={compact[0]}
        />
        <GridToolbarButton
          icon={Plus}
          label="Add Row"
          disabled={!bridge.editable}
          onClick={() => bridge.start_pending()}
          compact={compact[1]}
        />

        <GridToolbarButton
          icon={Trash2}
          label="Delete Row(s)"
          disabled={bridge.selected_cell_count === 0 || !bridge.editable}
          onClick={() => bridge.delete_rows()}
          className=""
          compact={compact[2]}
        />
        {bulk_edit && (
          <GridToolbarButton
            icon={Pencil}
            label="Bulk Edit"
            disabled={!bridge.editable}
            onClick={() => setBulkEditOpen(true)}
            compact={compact[5]}
          />
        )}
        <div className="bg-border mx-1 h-4 w-px" />
        <GridToolbarButton
          icon={bridge.loading ? Loader2 : Check}
          label={`Review${bridge.pending_count > 1 ? ` (${bridge.pending_count})` : ""}`}
          className={cn("bg-primary hover:bg-primary/70 rounded-r-none")}
          iconClassName={bridge.loading ? "size-3.5 animate-spin" : "size-3.5"}
          disabled={!bridge.pending_exists || bridge.loading}
          compact={compact[3]}
          onClick={() => setApplyChanges(bridge.get_pending_changes())}
        />
        {/* <Tooltip>
          <TooltipTrigger
            disabled={!compact}
            render={
              <Button
                size={compact ? "iconXs" : "sm"}
                className={cn(
                  "rounded-r-none",
                  compact ? "" : "h-6 px-2 text-xs",
                )}
                disabled={!bridge.pending_exists || bridge.loading}
                aria-label="Review and apply the pending changes"
                onClick={() => setApplyChanges(bridge.get_pending_changes())}
              >
                {bridge.loading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {!compact && (
                  <>
                    Review
                    {bridge.pending_count > 1
                      ? ` (${bridge.pending_count})`
                      : ""}
                  </>
                )}
              </Button>
            }
          />
          <TooltipContent side="top" className="z-10!">
            Review and apply the pending changes
            {bridge.pending_count > 1 ? ` (${bridge.pending_count})` : ""}
          </TooltipContent>
        </Tooltip> */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="iconXs"
                disabled={!bridge.pending_exists || bridge.loading}
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
          disabled={!bridge.pending_exists || bridge.loading}
          onClick={() => bridge.cancel_pending()}
          compact={compact[4]}
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
      {bulk_edit && (
        <BulkEditDialog
          open={bulk_edit_open}
          onOpenChange={setBulkEditOpen}
          conn_id={conn_id}
          table={bridge.table}
          columns={bulk_edit.columns}
          distinct={bulk_edit.distinct}
          selected_count={bridge.selected_cell_count}
          on_apply_selection={bridge.bulk_edit_selection}
        />
      )}
    </TooltipProvider>
  );
}

function GridToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  className,
  iconClassName,
  isIcon,
  compact,
}: {
  icon: LucideIcon;
  label: string;
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
        disabled={!icon_only}
        render={
          <Button
            variant="ghost"
            size={icon_only ? "iconXs" : "default"}
            disabled={disabled}
            aria-label={label}
            onClick={onClick}
            className={cn(
              {
                "text-2xs h-6 px-1.5 py-1 transition-all duration-100 ease-in-out":
                  !icon_only,
              },
              className,
            )}
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
