import { memo } from "react";
import {
  Handle,
  Position,
  useStore,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { TriangleAlert } from "lucide-react";
import type { GraphTable } from "@/shared/api/types";
import { cn } from "@/shared/lib/utils";
import { belowZoomFloor } from "../lib/graph";
import type { ClusterGeometry } from "../lib/er-geometry";
import type { HighlightState } from "./table-node";

export interface EntityNodeData extends Record<string, unknown> {
  table: GraphTable;
  geometry: ClusterGeometry;
  fks: Set<string> | undefined;
  state: HighlightState;
  matched: boolean;
}

export type EntityFlowNode = Node<EntityNodeData, "entity">;

export const entityHandle = (side: "l" | "r") => `e-${side}`;

/** An ER entity: its rectangle with the column ovals above and below,
 *  joined to it by short lines drawn here rather than as flow edges. */
export const EntityNode = memo(function EntityNode({
  data,
}: NodeProps<EntityFlowNode>) {
  const floor = useStore(belowZoomFloor);
  const { table, geometry, fks, state, matched } = data;
  const { rect } = geometry;
  const ovals = floor ? [] : geometry.ovals;
  const label =
    table.stub && table.schema ? `${table.schema}.${table.name}` : table.name;
  const midX = rect.x + rect.width / 2;

  return (
    <div
      data-state={state}
      aria-label={table.stub ? `${label}, in another schema` : label}
      className={cn(
        "text-small relative transition-opacity motion-reduce:transition-none",
        state === "dim" && "opacity-25",
      )}
      style={{ width: geometry.width, height: geometry.height }}
    >
      {ovals.length > 0 && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-visible"
          width={geometry.width}
          height={geometry.height}
        >
          {ovals.map((o) => {
            const above = o.y < rect.y;
            const x = o.x + o.width / 2;
            const edgeX = Math.min(
              rect.x + rect.width - 8,
              Math.max(rect.x + 8, x + (midX - x) * 0.3),
            );
            return (
              <line
                key={o.column.name}
                x1={x}
                y1={above ? o.y + o.height : o.y}
                x2={edgeX}
                y2={above ? rect.y : rect.y + rect.height}
                stroke="var(--muted-foreground)"
                strokeWidth={1}
              />
            );
          })}
        </svg>
      )}
      {ovals.map((o) => {
        const fk = fks?.has(o.column.name);
        return (
          <div
            key={o.column.name}
            className={cn(
              "bg-muted text-foreground border-obj-type text-caption absolute flex items-center justify-center rounded-full border px-2",
              o.column.primary_key && "underline underline-offset-2",
              fk && "italic",
            )}
            style={{ left: o.x, top: o.y, width: o.width, height: o.height }}
            title={`${o.column.name}: ${o.column.data_type}${o.column.not_null ? " NOT NULL" : ""}`}
          >
            <span className="min-w-0 truncate">{o.column.name}</span>
            <span className="sr-only">
              {o.column.primary_key ? ", primary key" : ""}
              {fk ? ", foreign key" : ""}
            </span>
          </div>
        );
      })}
      <div
        className={cn(
          "bg-card text-card-foreground border-obj-relation rounded-inset absolute flex items-center justify-center gap-1.5 border-2 px-2 shadow-xs",
          table.stub && "bg-muted/40 border-muted-foreground border-dashed",
          state === "selected" && "ring-primary ring-2",
          state === "neighbor" && "ring-primary/50 ring-1",
          matched && state !== "selected" && "ring-primary ring-2",
        )}
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          background: table.stub
            ? undefined
            : "color-mix(in oklab, var(--obj-relation) 10%, var(--card))",
        }}
      >
        <span
          className={cn(
            "min-w-0 truncate font-semibold",
            table.stub && "text-muted-foreground font-medium",
          )}
          title={label}
        >
          {label}
        </span>
        {table.error && (
          <TriangleAlert
            role="img"
            aria-label={`Sampling failed: ${table.error}`}
            className="text-destructive size-3.5 shrink-0"
          >
            <title>{table.error}</title>
          </TriangleAlert>
        )}
      </div>
      {(["l", "r"] as const).map((side) => (
        <Handle
          key={side}
          id={entityHandle(side)}
          type="target"
          position={side === "l" ? Position.Left : Position.Right}
          isConnectable={false}
          className="min-h-0! min-w-0! border-0! opacity-0!"
          style={{
            ...(side === "l"
              ? { left: rect.x }
              : { right: geometry.width - rect.x - rect.width }),
            top: rect.y + rect.height / 2,
          }}
        />
      ))}
    </div>
  );
});
