import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { GraphLink } from "@/shared/api/types";
import { cn } from "@/shared/lib/utils";
import type { HighlightState } from "./table-node";

export interface FkEdgeData extends Record<string, unknown> {
  link: GraphLink;
  /** Position among edges between the same two boxes, to spread them. */
  parallel: number;
  state: HighlightState;
}

export type FkFlowEdge = Edge<FkEdgeData, "fk">;

const LOOP_REACH = 28;

/** A self reference leaves and re-enters the box's right edge. */
function loopPath(sx: number, sy: number, ty: number, spread: number): string {
  const reach = LOOP_REACH + spread;
  const y2 = Math.abs(ty - sy) < 4 ? sy + 16 : ty;
  return `M ${sx} ${sy} H ${sx + reach} V ${y2} H ${sx}`;
}

function describe(l: GraphLink): string {
  const from = `${l.from_table}(${l.from_columns.join(", ")})`;
  const to = `${l.to_table}(${l.to_columns.join(", ")})`;
  const del = l.on_delete ? `, on delete ${l.on_delete.toLowerCase()}` : "";
  return `${from} → ${to}${l.inferred ? ", inferred" : ""}${del}`;
}

export const FkEdge = memo(function FkEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<FkFlowEdge>) {
  if (!data) return null;
  const link = data.link;
  const spread = data.parallel * 10;
  const [path, labelX, labelY] =
    source === target
      ? [
          loopPath(sourceX, sourceY, targetY, spread),
          sourceX + LOOP_REACH + spread,
          (sourceY + targetY) / 2,
        ]
      : getSmoothStepPath({
          sourceX,
          sourceY,
          targetX,
          targetY,
          sourcePosition,
          targetPosition,
          borderRadius: 6,
          offset: 16 + spread,
        });
  const state = data?.state;
  return (
    <>
      <g className={cn(state === "dim" && "opacity-15")}>
        <title>{describe(link)}</title>
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          interactionWidth={12}
          style={{
            stroke:
              state === "selected" || state === "neighbor"
                ? "var(--primary)"
                : "var(--muted-foreground)",
            strokeWidth: state === "selected" ? 2 : 1.25,
            strokeDasharray: link.inferred ? "5 4" : undefined,
          }}
        />
      </g>
      {link.inferred && state !== "dim" && (
        <EdgeLabelRenderer>
          <span
            className="bg-background text-muted-foreground rounded-inset text-caption pointer-events-none absolute border px-1"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            inferred
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
