import {
  Fragment,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  ChevronDown,
  Columns3,
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
import { useWriteConfirm } from "@/shared/hooks/use-write-confirm";
import { useStudioStore, type GridBridge } from "@/shared/store";
import {
  pending_changes_to_row_diff,
  type PendingChange,
} from "./grid-context";
import { FilterBar, type FilterBarProps } from "./filter-bar";
import { BulkEditDialog } from "./bulk-edit-dialog";
import { ColumnVisibilityMenu } from "./column-visibility-menu";
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
const PANE_COMPACT_BELOW_PX = 920;
const ONE_BUTTON_MIN_SHRINK = 30;

/** Watches `ref`'s element (the owning PANE, not this toolbar itself — see
 *  `GridActionBar`'s own doc comment) and reports whether it's narrower
 *  than `PANE_COMPACT_BELOW_PX`. Shared by `TablePane` and
 *  `MongoCollectionPane`, each of which owns the ref on its own root
 *  element and passes the result down as `GridActionBar`'s `compact` prop. */
export function usePaneCompactWidth(
  ref: RefObject<HTMLElement | null>,
  noOfElements: number,
  paneCompactBelowPx: number = PANE_COMPACT_BELOW_PX,
  oneButtonMinShrink: number = ONE_BUTTON_MIN_SHRINK,
) {
  const [compact, setCompact] = useState(Array(noOfElements).fill(false));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // A background tab's pane is `display:none` while inactive, which
      // reports a 0 width here — not a real "very narrow" measurement, just
      // "not visible right now." Recomputing off that would collapse every
      // button to icon-only while hidden, then immediately expand them back
      // on the very next real measurement when the tab is switched back to
      // — exactly the flash this guard avoids, by just keeping whatever was
      // last computed from an actual visible width.
      if (entry && entry.contentRect.width > 0)
        setCompact((prev) => {
          // entry.contentRect.width < PANE_COMPACT_BELOW_PX;
          const new_compact = prev.map(
            (_, index) =>
              entry.contentRect.width <
              paneCompactBelowPx - index * oneButtonMinShrink,
          );
          return new_compact;
        });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, paneCompactBelowPx, oneButtonMinShrink]);
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
  // Direct Apply skips the review dialog, so on a Production connection (or
  // one with Confirm before writes on) it asks first (spec 0007). Review is
  // itself the confirmation and just wears the environment chip.
  const write_confirm = useWriteConfirm(conn_id);
  // Why the write buttons are off on a read only connection (spec 0007).
  const read_only_reason = bridge.read_only
    ? "Read only connection: writes are refused"
    : undefined;
  // ColumnVisibilityMenu takes no `compact` prop (it's icon-only already,
  // nothing to collapse) — its factory just ignores the argument every
  // other entry spreads onto `GridToolbarButton`. A function expecting
  // fewer parameters than `ButtonFactory` declares still satisfies it
  // structurally, so this doesn't need its own separate array type.
  type ButtonFactory = (props: { compact: boolean }) => ReactNode;
  const buttons: ButtonFactory[] = [
    (props) => (
      <ColumnVisibilityMenu
        columns={bridge.all_columns}
        hidden={bridge.hidden_columns}
        on_toggle={bridge.toggle_column_visibility}
        on_reorder={bridge.reorder_column}
        on_reveal={bridge.reveal_column}
      >
        {/* No `onClick` — `ColumnVisibilityMenu` renders this button as its
            own popover trigger, so opening/closing is already handled by
            wrapping it, not by a click handler here. */}
        <GridToolbarButton icon={Columns3} label="Columns" {...props} />
      </ColumnVisibilityMenu>
    ),
    (props) => (
      <GridToolbarButton
        icon={RefreshCw}
        label="Refresh"
        disabled={bridge.loading}
        onClick={() => bridge.refresh()}
        iconClassName={bridge.loading ? "animate-spin" : undefined}
        {...props}
      />
    ),
    (props) => (
      <GridToolbarButton
        icon={Plus}
        label="Add Row"
        disabled={!bridge.editable}
        disabled_reason={read_only_reason}
        onClick={() => bridge.start_pending()}
        {...props}
      />
    ),

    (props) => (
      <GridToolbarButton
        icon={Trash2}
        label="Delete Row(s)"
        disabled={bridge.selected_cell_count === 0 || !bridge.editable}
        disabled_reason={read_only_reason}
        onClick={() => bridge.delete_rows()}
        className=""
        {...props}
      />
    ),
    (props) => (
      <GridToolbarButton
        icon={Pencil}
        label="Bulk Edit"
        disabled={!bulk_edit || !bridge.editable}
        disabled_reason={read_only_reason}
        onClick={() => setBulkEditOpen(true)}
        {...props}
      />
    ),
    (props) => (
      <GridToolbarButton
        icon={RotateCcw}
        label="Undo"
        disabled={!bridge.pending_exists || bridge.loading}
        onClick={() => bridge.cancel_pending()}
        {...props}
      />
    ),
    (props) => (
      <>
        <GridToolbarButton
          icon={bridge.loading ? Loader2 : Check}
          label={`Review${bridge.pending_count > 1 ? ` (${bridge.pending_count})` : ""}`}
          className={cn("bg-primary hover:bg-primary/70 rounded-r-none text-primary-foreground")}
          iconClassName={bridge.loading ? "size-3.5 animate-spin" : "size-3.5"}
          disabled={!bridge.pending_exists || bridge.loading}
          onClick={() => setApplyChanges(bridge.get_pending_changes())}
          {...props}
        />
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
              onClick={() =>
                void write_confirm
                  .confirm_write(
                    `Apply ${bridge.pending_count} pending change${bridge.pending_count === 1 ? "" : "s"} to ${bridge.table}`,
                  )
                  .then((ok) => ok && bridge.apply_pending())
              }
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
      </>
    ),
  ];
  const compact = usePaneCompactWidth(pane_ref, buttons.length);

  return (
    <TooltipProvider delay={500}>
      <div className="flex min-w-0 flex-1 shrink-0 items-center gap-1">
        <div className="bg-border mx-1 h-4 w-px" />

        {filter_bar ? (
          <FilterBar {...filter_bar} />
        ) : (
          <div className="flex-1" />
        )}

        <div className="bg-border mx-1 h-4 w-px" />
        {/* Icon cluster first, then add/delete, then the pending-changes
         *  commit group last — same left-to-right rhythm as a typical
         *  DB-client grid toolbar (icons, row actions, commit/rollback). */}
        {buttons.map((btn, idx) => (
          <Fragment key={idx}>
            {btn({ compact: compact[idx] })}
            {idx === 4 && <div className="bg-border mx-1 h-4 w-px" />}
          </Fragment>
        ))}
      </div>
      {apply_changes && (
        <ApplyChangesDialog
          rows={pending_changes_to_row_diff(apply_changes)}
          selectable
          on_apply={(keepIds) => bridge.apply_pending(keepIds)}
          on_close={() => setApplyChanges(null)}
        />
      )}
      {write_confirm.dialog}
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
  disabled_reason,
  className,
  iconClassName,
  isIcon,
  compact,
}: {
  icon: LucideIcon;
  label: string;
  /** Omitted when this button is itself a trigger for something else (e.g.
   *  wrapped in `ColumnVisibilityMenu`), which already handles opening it. */
  onClick?: () => void;
  disabled?: boolean;
  /** Why the button is disabled, shown as a tooltip. Only shown while it is
   *  disabled, and set only when the reason is one the user can change. */
  disabled_reason?: string;
  className?: string;
  iconClassName?: string;
  isIcon?: boolean;
  /** Collapses a labeled button to icon-only, same as `isIcon`, but driven
   *  by the toolbar's own measured width instead of being permanent. */
  compact?: boolean;
}) {
  const icon_only = isIcon || compact;
  const button = (
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
  // A disabled button gets no pointer events, so its reason rides on a
  // wrapper that does.
  if (disabled && disabled_reason) {
    return (
      <span title={disabled_reason} className="inline-flex">
        {button}
      </span>
    );
  }
  return button;
}
