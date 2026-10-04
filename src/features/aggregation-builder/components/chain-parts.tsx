import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useCardActions } from "../lib/card-actions";
import { ADD_NODE_WIDTH } from "../lib/layout";
import type { ChainRef } from "../lib/model";
import { OperatorMenu } from "./operator-menu";

export interface InsertEdgeData extends Record<string, unknown> {
  /** Where a stage added on this link goes in its chain. */
  index: number;
  /** The chain, the main one when absent. */
  chain?: ChainRef;
  /** A palette stage is held over this link. */
  active?: boolean;
}

export type InsertEdge = Edge<InsertEdgeData, "insert">;

/** A link between two cards, with a "+" in the middle that adds a stage
 *  between them. */
export const InsertLink = memo(function InsertLink({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<InsertEdge>) {
  const actions = useCardActions();
  const path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  const midY = (sourceY + targetY) / 2;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        className={
          data?.active ? "stroke-primary! stroke-2!" : "stroke-border!"
        }
      />
      {data && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${sourceX}px, ${midY}px)`,
            }}
          >
            <OperatorMenu
              onPick={(op) => actions.insert(data.index, op, data.chain)}
              trigger={
                <Button
                  variant="outline"
                  size="iconXs"
                  className="bg-background text-muted-foreground hover:text-foreground rounded-pill size-5"
                  aria-label={`Add a stage at position ${data.index + 1}`}
                  title="Add a stage here"
                >
                  <Plus className="size-3" />
                </Button>
              }
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export interface AddNodeData extends Record<string, unknown> {
  /** The chain's length: a stage added here goes last. */
  index: number;
  /** The chain, the main one when null. */
  chain: ChainRef;
  /** A palette stage dropped now would land here. */
  active?: boolean;
}

export type AddStageNode = Node<AddNodeData, "add">;

/** The button under the last card that appends a stage. */
export const AddStage = memo(function AddStage({
  data,
}: NodeProps<AddStageNode>) {
  const actions = useCardActions();
  return (
    <div style={{ width: ADD_NODE_WIDTH }} className="flex justify-center">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="pointer-events-none opacity-0!"
      />
      <OperatorMenu
        allowWrite={!data.chain}
        onPick={(op) => actions.insert(data.index, op, data.chain)}
        trigger={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "nodrag bg-background rounded-pill border-dashed",
              data.active && "border-primary text-primary",
            )}
          >
            <Plus className="size-3.5" />
            Add stage
          </Button>
        }
      />
    </div>
  );
});
