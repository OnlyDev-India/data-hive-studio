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
import { useAddMenu, type AddPlace } from "./add-menu";
import { ADD_NODE_WIDTH } from "./layout";

export interface InsertEdgeData extends AddPlace, Record<string, unknown> {
  /** A palette card is held over this link. */
  active?: boolean;
}

export type InsertEdge = Edge<InsertEdgeData, "insert">;

/** A link between two cards, with a "+" in the middle that adds a card
 *  between them. */
export const InsertLink = memo(function InsertLink({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<InsertEdge>) {
  const menu = useAddMenu();
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
            {menu.render(
              data,
              <Button
                variant="outline"
                size="iconXs"
                className="bg-background text-muted-foreground hover:text-foreground rounded-pill size-5"
                aria-label={`Add a ${menu.noun} at position ${data.index + 1}`}
                title={`Add a ${menu.noun} here`}
              >
                <Plus className="size-3" />
              </Button>,
              false,
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

export interface AddNodeData extends AddPlace, Record<string, unknown> {
  /** A palette card dropped now would land here. */
  active?: boolean;
}

export type AddCardNode = Node<AddNodeData, "add">;

/** The button under a chain's last card that appends a card. */
export const AddCard = memo(function AddCard({ data }: NodeProps<AddCardNode>) {
  const menu = useAddMenu();
  return (
    <div style={{ width: ADD_NODE_WIDTH }} className="flex justify-center">
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className="pointer-events-none opacity-0!"
      />
      {menu.render(
        data,
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "nodrag nopan bg-background rounded-pill border-dashed",
            data.active && "border-primary text-primary",
          )}
        >
          <Plus className="size-3.5" />
          Add {menu.noun}
        </Button>,
        true,
      )}
    </div>
  );
});
