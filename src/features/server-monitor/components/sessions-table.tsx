import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { MoreHorizontal } from "lucide-react";
import type { MonitorEngine, SessionRow } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import {
  displayDuration,
  firstLine,
  formatDuration,
  isSlow,
  rowActions,
  type RowAction,
} from "../lib/sessions";
import { StateBadge, ThisAppTag } from "./badges";

const ROW_HEIGHT = 30;

/** Column template shared by the header and every row. */
const COLUMNS =
  "grid grid-cols-[5.5rem_minmax(5rem,7rem)_minmax(5rem,8rem)_8.5rem_5rem_minmax(6rem,9rem)_minmax(10rem,1fr)_2rem] items-center gap-2 px-3";

/** The Sessions list (AC-4): a light read only table, virtualized, keyed by
 *  id so a refresh updates rows in place and the selected row keeps its
 *  place. */
export function SessionsTable({
  rows,
  engine,
  slow_ms,
  selected,
  locked,
  on_select,
  on_clear,
  on_action,
  on_menu_open,
}: {
  rows: SessionRow[];
  engine: MonitorEngine;
  slow_ms: number;
  selected: string | null;
  locked: boolean;
  on_select: (id: string) => void;
  /** A click on empty space resumes polling. */
  on_clear: () => void;
  on_action: (row: SessionRow, a: RowAction) => void;
  on_menu_open: (open: boolean) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer instance is stable; the rule can't see that
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (i) => rows[i]?.id ?? i,
    overscan: 12,
  });
  const id_label = engine === "postgres" ? "pid" : "opid";
  const wait_label = engine === "postgres" ? "Wait event" : "Op type";

  return (
    <div role="table" aria-label="Sessions" className="flex min-h-0 flex-1 flex-col">
      <div
        role="row"
        className={cn(
          COLUMNS,
          "text-muted-foreground text-caption bg-chrome h-7 shrink-0 border-b font-medium",
        )}
      >
        <span role="columnheader">{id_label}</span>
        <span role="columnheader">User</span>
        <span role="columnheader">Database</span>
        <span role="columnheader">State</span>
        <span role="columnheader" aria-sort="descending">
          Duration
        </span>
        <span role="columnheader">{wait_label}</span>
        <span role="columnheader">Query</span>
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) on_clear();
        }}
      >
        <div
          className="relative w-full"
          style={{ height: virtual.getTotalSize() }}
          onClick={(e) => {
            if (e.target === e.currentTarget) on_clear();
          }}
        >
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const slow = isSlow(row, slow_ms);
            const actions = rowActions(row, engine, locked);
            const is_selected = selected === row.id;
            return (
              <div
                key={item.key}
                role="row"
                aria-selected={is_selected}
                tabIndex={0}
                onClick={() => on_select(row.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    on_select(row.id);
                  }
                }}
                className={cn(
                  COLUMNS,
                  "text-small absolute top-0 left-0 w-full cursor-default border-b outline-none",
                  "hover:bg-accent/50 focus-visible:bg-accent/60",
                  slow && "bg-warning/10",
                  is_selected && "bg-accent",
                )}
                style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
              >
                <span role="cell" className="truncate font-mono tabular-nums">
                  {row.id}
                </span>
                <span role="cell" className="truncate">
                  {row.user ?? "—"}
                </span>
                <span role="cell" className="truncate">
                  {row.database ?? "—"}
                </span>
                <span role="cell" className="flex min-w-0 items-center gap-1">
                  <StateBadge state={row.state} />
                </span>
                <span
                  role="cell"
                  className={cn(
                    "truncate font-mono tabular-nums",
                    slow && "text-warning-dark font-semibold",
                  )}
                >
                  {formatDuration(displayDuration(row))}
                </span>
                <span role="cell" className="text-muted-foreground truncate">
                  {(engine === "postgres" ? row.wait : row.op_type) ?? "—"}
                </span>
                <span role="cell" className="flex min-w-0 items-center gap-1.5">
                  {row.is_this_app && <ThisAppTag />}
                  {row.query_hidden ? (
                    <span className="text-muted-foreground truncate italic">
                      Hidden by the server
                    </span>
                  ) : (
                    <span className="truncate font-mono" title={row.query ?? undefined}>
                      {firstLine(row.query) || "—"}
                    </span>
                  )}
                </span>
                <span role="cell" className="flex justify-end">
                  {actions.length > 0 && (
                    <RowMenu
                      actions={actions}
                      on_pick={(a) => on_action(row, a)}
                      on_open={on_menu_open}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The row's kill menu (AC-12). Disabled items say why in their tooltip. */
export function RowMenu({
  actions,
  on_pick,
  on_open,
}: {
  actions: RowAction[];
  on_pick: (a: RowAction) => void;
  on_open: (open: boolean) => void;
}) {
  return (
    <DropdownMenu onOpenChange={on_open}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Session actions"
            title="Session actions"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {actions.map((a) => (
          <DropdownMenuItem
            key={a.action}
            disabled={!a.enabled}
            title={a.reason}
            variant={a.action === "cancel" ? "default" : "destructive"}
            className={cn(!a.enabled && "flex-col items-start gap-0")}
            onClick={() => on_pick(a)}
          >
            <span>{a.label}…</span>
            {/* A disabled item takes no pointer events, so no tooltip: the
                reason is spelled out under the label instead. */}
            {a.reason && (
              <span className="text-muted-foreground text-caption">
                {a.reason}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
