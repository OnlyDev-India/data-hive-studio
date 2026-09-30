import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/shared/lib/utils";
import type { ErDiamond } from "../lib/er-model";
import type { HighlightState } from "./table-node";

export interface DiamondNodeData extends Record<string, unknown> {
  diamond: ErDiamond;
  state: HighlightState;
}

export type DiamondFlowNode = Node<DiamondNodeData, "diamond">;

/** Left and right points, plus top and bottom for a self link's two lines. */
export type DiamondSide = "l" | "r" | "t" | "b";

export const diamondHandle = (side: DiamondSide) => `d-${side}`;

const POSITION: Record<DiamondSide, Position> = {
  l: Position.Left,
  r: Position.Right,
  t: Position.Top,
  b: Position.Bottom,
};

/** An ER relationship: a diamond labelled with the link's FK columns. */
export const RelationshipNode = memo(function RelationshipNode({
  data,
}: NodeProps<DiamondFlowNode>) {
  const { diamond, state } = data;
  const { width: w, height: h } = diamond;
  const lit = state === "selected" || state === "neighbor";
  return (
    <div
      data-state={state}
      aria-label={`Link ${diamond.label}`}
      title={diamond.title}
      className={cn(
        "text-caption relative flex items-center justify-center transition-opacity motion-reduce:transition-none",
        state === "dim" && "opacity-25",
      )}
      style={{ width: w, height: h }}
    >
      <svg
        aria-hidden
        className="absolute inset-0 overflow-visible"
        width={w}
        height={h}
      >
        <polygon
          points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`}
          fill="color-mix(in oklab, var(--obj-key) 14%, var(--card))"
          stroke={lit ? "var(--primary)" : "var(--obj-key)"}
          strokeWidth={state === "selected" ? 2.5 : 1.5}
          strokeDasharray={diamond.inferred ? "5 4" : undefined}
        />
      </svg>
      <span
        className="text-foreground relative min-w-0 truncate font-medium"
        style={{ maxWidth: w * 0.62 }}
      >
        {diamond.label}
      </span>
      {(Object.keys(POSITION) as DiamondSide[]).map((side) => (
        <Handle
          key={side}
          id={diamondHandle(side)}
          type="source"
          position={POSITION[side]}
          isConnectable={false}
          className="!min-h-0 !min-w-0 !border-0 !opacity-0"
        />
      ))}
    </div>
  );
});
