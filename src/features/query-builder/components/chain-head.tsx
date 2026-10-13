import { memo } from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Braces, ChevronDown, ChevronRight } from "lucide-react";
import { CARD_WIDTH } from "@/shared/components/builder-canvas";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useClauseActions } from "../lib/card-actions";

const HIDDEN_HANDLE = "pointer-events-none opacity-0!";

export interface ChainHeadData extends Record<string, unknown> {
  chain: string;
  /** What the chain is to its card: "subquery in WHERE, card 3". */
  title: string;
  /** "subquery on customers, 3 cards", shown while collapsed. */
  summary: string;
  collapsed: boolean;
  /** Reads the outer row (or itself), so previews only inside its query. */
  outerRow: boolean;
  /** Its query is not the current one, so it runs no previews. */
  stale: boolean;
}

export type ChainHeadNode = Node<ChainHeadData, "chain">;

/** The top of a subquery chain: what it is to its card, a note when it
 *  reads the outer row, and collapse to a one line chip. */
export const ChainHead = memo(function ChainHead({
  data,
}: NodeProps<ChainHeadNode>) {
  const { chain, title, summary, collapsed, outerRow, stale } = data;
  const actions = useClauseActions();
  return (
    <div
      style={{ width: CARD_WIDTH }}
      className={cn(
        "bg-muted/60 rounded-control text-small flex min-h-9 items-center gap-1.5 border border-dashed py-0.5 pr-1 pl-1",
        stale && "opacity-70",
      )}
      aria-label={collapsed ? `${title}, ${summary}, collapsed` : title}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <Button
        variant="ghost"
        size="iconXs"
        className="nodrag text-muted-foreground"
        aria-label={collapsed ? "Expand subquery" : "Collapse subquery"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand" : "Collapse to one line"}
        onClick={() => actions.toggleChain(chain)}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronDown className="size-3.5" />
        )}
      </Button>
      <Braces className="text-muted-foreground size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {title}
        {collapsed && (
          <span className="text-muted-foreground font-mono"> · {summary}</span>
        )}
      </span>
      {outerRow && (
        <Badge
          variant="muted"
          className="ml-auto shrink-0"
          title="It reads a column of the query around it, so its cards preview only inside that query"
        >
          Depends on the outer row
        </Badge>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
});

export type ChainEdge = Edge<Record<string, unknown>, "chain">;

/** The link from a card to one of its subquery chains. */
export const ChainLink = memo(function ChainLink({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<ChainEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  return (
    <BaseEdge
      id={id}
      path={path}
      className="stroke-border! [stroke-dasharray:4_3]"
    />
  );
});
