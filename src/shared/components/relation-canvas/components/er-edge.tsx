import { memo } from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  Position,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { cn } from "@/shared/lib/utils";
import type { EndMark } from "../lib/er-model";
import type { HighlightState } from "./table-node";

export interface ErEdgeData extends Record<string, unknown> {
  mark: EndMark;
  inferred: boolean;
  state: HighlightState;
}

export type ErFlowEdge = Edge<ErEdgeData, "er">;

const MARK_TITLE: Record<EndMark, string> = {
  one: "exactly one",
  "zero-one": "zero or one",
  many: "zero or many",
};

/** The crow's foot at an entity edge `x`, drawn away from it along `dir`. */
function markPath(mark: EndMark, x: number, y: number, dir: number) {
  const at = (d: number) => x + dir * d;
  const bar = (d: number) => `M ${at(d)} ${y - 6} V ${y + 6}`;
  if (mark === "one") return { d: `${bar(5)} ${bar(9)}`, circle: null };
  if (mark === "zero-one") return { d: bar(5), circle: at(12) };
  const tip = at(9);
  return {
    d: `M ${x} ${y - 6} L ${tip} ${y} M ${x} ${y + 6} L ${tip} ${y}`,
    circle: at(13),
  };
}

/** A line from a diamond (source) to an entity (target), with the target
 *  end's crow's foot mark. */
export const ErEdge = memo(function ErEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<ErFlowEdge>) {
  if (!data) return null;
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 6,
    offset: 20,
  });
  const { state, mark } = data;
  const lit = state === "selected" || state === "neighbor";
  const color = lit ? "var(--primary)" : "var(--muted-foreground)";
  const width = state === "selected" ? 2 : 1.25;
  const dir = targetPosition === Position.Left ? -1 : 1;
  const m = markPath(mark, targetX, targetY, dir);
  return (
    <g className={cn(state === "dim" && "opacity-15")}>
      <title>{MARK_TITLE[mark]}</title>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={10}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: data.inferred ? "5 4" : undefined,
        }}
      />
      <path d={m.d} fill="none" stroke={color} strokeWidth={width} />
      {m.circle != null && (
        <circle
          cx={m.circle}
          cy={targetY}
          r={3.5}
          fill="var(--background)"
          stroke={color}
          strokeWidth={width}
        />
      )}
    </g>
  );
});
