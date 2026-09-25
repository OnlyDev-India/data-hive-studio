import { useId, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Loader2, Square } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui";
import { cn } from "@/shared/lib/utils";
import type { PlanNode, PlanResult } from "@/shared/api";
import {
  flattenPlan,
  formatCost,
  formatCount,
  formatMillis,
  hasActuals,
  initialCollapsed,
  moveActive,
  parentIndex,
  type PlanRow,
} from "../lib/plan-tree";
import type { PlanTab } from "../lib/use-plan-tabs";

const DIALECT_LABEL: Record<PlanResult["dialect"], string> = {
  postgres: "PostgreSQL",
  sqlite: "SQLite",
  mongodb: "MongoDB",
};

/** What a Plan tab shows: the plan as a tree, or why there is none. */
export function PlanView({
  tab,
  stale = false,
  on_stop,
}: {
  tab: PlanTab;
  /** Stops the call while the database is still answering. */
  on_stop?: () => void;
  /** The editor no longer holds this tab's statement. */
  stale?: boolean;
}) {
  // A state (not a ref) so the virtualizer sees the element once it mounts.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const result = tab.result;
  if (result === null) {
    return (
      <div className="flex flex-col gap-2 pt-4">
        <div className="flex items-center gap-2 px-3 text-xs">
          <Loader2 className="size-3.5 animate-spin" />
          <span
            className="text-muted-foreground min-w-0 flex-1 truncate font-mono"
            title={tab.statement}
          >
            {tab.mode === "analyze" ? "Analyzing: " : "Planning: "}
            {tab.statement}
          </span>
          {tab.run_id && on_stop && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 gap-1 text-xs"
              disabled={tab.stopping}
              onClick={on_stop}
            >
              <Square className="size-3" />
              {tab.stopping ? "Stopping…" : "Stop"}
            </Button>
          )}
        </div>
        <div
          role="status"
          aria-label="Loading plan"
          className="flex flex-col gap-2"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-muted h-8 animate-pulse rounded-md" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlanHeader result={result} stale={stale} />
      <div ref={setScroller} className="min-h-0 flex-1 overflow-auto">
        {result.cancelled ? (
          <Notice title="Stopped">
            {result.mode === "analyze"
              ? "You stopped this Explain Analyze. Nothing it ran was kept, because the transaction was rolled back."
              : "You stopped this Explain."}
          </Notice>
        ) : result.unsupported ? (
          <Notice title="This statement can't be explained">
            {result.unsupported}
          </Notice>
        ) : result.error ? (
          <Notice title="The database could not explain this statement" error>
            {result.error}
          </Notice>
        ) : result.root === null ? (
          <Notice title="No plan steps">
            The database returned no plan for this statement. This is normal for
            a few statements, such as a DELETE with no WHERE on SQLite.
          </Notice>
        ) : (
          <PlanTree root={result.root} scroller={scroller} />
        )}
      </div>
    </div>
  );
}

function PlanHeader({ result, stale }: { result: PlanResult; stale: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-xs">
      <span
        className="text-muted-foreground min-w-0 flex-1 truncate font-mono"
        title={result.statement}
      >
        {result.statement}
      </span>
      <Badge variant="muted">{DIALECT_LABEL[result.dialect]}</Badge>
      <Badge variant={result.mode === "analyze" ? "info" : "muted"}>
        {result.mode === "analyze" ? "Analyzed" : "Estimate"}
      </Badge>
      {stale && (
        <Badge
          variant="warning"
          title="The editor no longer contains this statement"
        >
          Stale
        </Badge>
      )}
      {result.truncated && <Badge variant="warning">Truncated</Badge>}
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {formatMillis(result.elapsed_ms)}
      </span>
    </div>
  );
}

function Notice({
  title,
  error,
  children,
}: {
  title: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "m-4 rounded-md border p-4 text-sm",
        error ? "border-destructive/40 bg-destructive/5" : "bg-muted/40",
      )}
    >
      <p className={cn("font-medium", error && "text-destructive")}>{title}</p>
      <p className="text-muted-foreground mt-1 whitespace-pre-wrap select-text">
        {children}
      </p>
    </div>
  );
}

/** The columns shown for a plan; the actual ones only when it was analyzed. */
function columnsFor(root: PlanNode) {
  const base = [
    {
      key: "cost",
      title: "Cost",
      read: (n: PlanNode) => formatCost(n.total_cost),
    },
    {
      key: "est",
      title: "Est. rows",
      read: (n: PlanNode) => formatCount(n.est_rows),
    },
  ];
  if (!hasActuals(root)) return base;
  return [
    ...base,
    {
      key: "actual",
      title: "Actual rows",
      read: (n: PlanNode) => formatCount(n.actual_rows),
    },
    {
      key: "time",
      title: "Time",
      read: (n: PlanNode) => formatMillis(n.actual_time_ms),
    },
    {
      key: "loops",
      title: "Loops",
      read: (n: PlanNode) => formatCount(n.loops),
    },
  ];
}

/** Rough row heights; the virtualizer measures the real ones once rendered. */
const ROW_HEIGHT = 28;
const CONDITION_LINE_HEIGHT = 16;

function PlanTree({
  root,
  scroller,
}: {
  root: PlanNode;
  scroller: HTMLElement | null;
}) {
  const grid_id = useId();
  const [collapsed, setCollapsed] = useState(() => initialCollapsed(root));
  const [active_id, setActiveId] = useState<number | null>(null);
  const rows = useMemo(() => flattenPlan(root, collapsed), [root, collapsed]);
  const columns = useMemo(() => columnsFor(root), [root]);
  const template = `minmax(18rem, 1fr) repeat(${columns.length}, 6rem)`;

  // Falls back to the first row when the active one was folded away.
  const found = rows.findIndex((r) => r.node.id === active_id);
  const active_index = found === -1 ? 0 : found;

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer instance is stable; the rule can't see that
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (i) =>
      ROW_HEIGHT +
      (rows[i].node.condition
        ? rows[i].node.condition.split("\n").length * CONDITION_LINE_HEIGHT
        : 0),
    getItemKey: (i) => rows[i].node.id,
    overscan: 12,
  });

  const toggle = (id: number) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const activate = (index: number) => {
    setActiveId(rows[index].node.id);
    virtualizer.scrollToIndex(index);
  };

  const on_key_down = (e: React.KeyboardEvent) => {
    const row = rows[active_index];
    if (!row) return;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "Home":
      case "End": {
        const next = moveActive(rows, active_index, e.key);
        if (next !== null) activate(next);
        break;
      }
      case "ArrowRight":
        if (row.has_children && !row.expanded) toggle(row.node.id);
        else if (row.expanded) activate(active_index + 1);
        break;
      case "ArrowLeft": {
        if (row.expanded) toggle(row.node.id);
        else {
          const parent = parentIndex(rows, active_index);
          if (parent !== null) activate(parent);
        }
        break;
      }
      case "Enter":
      case " ":
        if (row.has_children) toggle(row.node.id);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  return (
    <div
      role="treegrid"
      aria-label="Query plan"
      aria-rowcount={rows.length + 1}
      aria-activedescendant={`${grid_id}-${rows[active_index]?.node.id}`}
      tabIndex={0}
      className="focus-visible:ring-ring/50 min-w-max text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset"
      data-selectable
      onKeyDown={on_key_down}
    >
      <div
        role="row"
        className="bg-background text-muted-foreground sticky top-0 z-10 grid border-b text-xs font-medium"
        style={{ gridTemplateColumns: template }}
      >
        <div role="columnheader" className="px-3 py-1.5">
          Node
        </div>
        {columns.map((c) => (
          <div
            key={c.key}
            role="columnheader"
            className="px-3 py-1.5 text-right"
          >
            {c.title}
          </div>
        ))}
      </div>
      <div
        className="relative"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((item) => (
          <PlanRowView
            key={item.key}
            row={rows[item.index]}
            columns={columns}
            template={template}
            dom_id={`${grid_id}-${rows[item.index].node.id}`}
            index={item.index}
            active={item.index === active_index}
            top={item.start}
            measure={virtualizer.measureElement}
            on_toggle={toggle}
            on_select={() => setActiveId(rows[item.index].node.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PlanRowView({
  row,
  columns,
  template,
  dom_id,
  index,
  active,
  top,
  measure,
  on_toggle,
  on_select,
}: {
  row: PlanRow;
  columns: ReturnType<typeof columnsFor>;
  template: string;
  dom_id: string;
  index: number;
  active: boolean;
  top: number;
  measure: (el: HTMLElement | null) => void;
  on_toggle: (id: number) => void;
  on_select: () => void;
}) {
  const { node, depth, has_children, expanded } = row;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      id={dom_id}
      ref={measure}
      data-index={index}
      role="row"
      aria-level={depth + 1}
      aria-expanded={has_children ? expanded : undefined}
      aria-selected={active}
      className={cn(
        "hover:bg-muted/50 absolute top-0 left-0 grid w-full items-start",
        active && "bg-muted/60",
      )}
      style={{
        gridTemplateColumns: template,
        transform: `translateY(${top}px)`,
      }}
      onClick={on_select}
    >
      <div
        role="gridcell"
        className="flex min-w-0 items-start gap-1 py-1 pr-3"
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
      >
        {has_children ? (
          <button
            type="button"
            tabIndex={-1}
            className="text-muted-foreground hover:text-foreground mt-0.5 shrink-0"
            aria-label={expanded ? "Collapse" : "Expand"}
            aria-expanded={expanded}
            onClick={() => on_toggle(node.id)}
          >
            <Chevron className="size-3.5" />
          </button>
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <div className="min-w-0">
          <div className="truncate">
            <span className="font-semibold">{node.label}</span>
            {node.target && (
              <span className="text-muted-foreground"> {node.target}</span>
            )}
          </div>
          {node.condition && (
            <div className="text-muted-foreground font-mono text-xs break-words whitespace-pre-wrap">
              {node.condition}
            </div>
          )}
        </div>
      </div>
      {columns.map((c) => (
        <div
          key={c.key}
          role="gridcell"
          className="px-3 py-1 text-right tabular-nums"
        >
          {c.read(node)}
        </div>
      ))}
    </div>
  );
}
