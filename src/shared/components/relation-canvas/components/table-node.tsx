import { memo } from "react";
import {
  Handle,
  Position,
  useStore,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  KeyRound,
  Link2,
  Table as TableIcon,
  TriangleAlert,
} from "lucide-react";
import type { GraphTable } from "@/shared/api/types";
import { cn } from "@/shared/lib/utils";
import {
  belowZoomFloor,
  shownMode,
  visibleColumns,
  type ColumnMode,
} from "../lib/graph";
import { HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT } from "../lib/elk-graph";

export type HighlightState = "selected" | "neighbor" | "dim" | undefined;

export interface TableNodeData extends Record<string, unknown> {
  table: GraphTable;
  fks: Set<string> | undefined;
  mode: ColumnMode;
  state: HighlightState;
  /** A search or focus match to flash. */
  matched: boolean;
}

export type TableFlowNode = Node<TableNodeData, "table">;

/** Handle id for one row's side: `null` column = the header row. */
export const handleId = (
  column: string | null,
  kind: "s" | "t",
  side: "l" | "r",
) => `${side}-${kind}-${column ?? ""}`;

/** Invisible, not connectable; edges only need somewhere to attach. Sits
 *  at the middle of its (relative) row. */
function RowHandles({ column }: { column: string | null }) {
  return (
    <>
      {(["l", "r"] as const).flatMap((side) =>
        (["s", "t"] as const).map((kind) => (
          <Handle
            key={`${side}${kind}`}
            id={handleId(column, kind, side)}
            type={kind === "s" ? "source" : "target"}
            position={side === "l" ? Position.Left : Position.Right}
            isConnectable={false}
            className="!min-h-0 !min-w-0 !border-0 !opacity-0"
          />
        )),
      )}
    </>
  );
}

export const TableNode = memo(function TableNode({
  data,
}: NodeProps<TableFlowNode>) {
  const floor = useStore(belowZoomFloor);
  const { table, fks, state, matched } = data;
  const columns = visibleColumns(table, shownMode(data.mode, floor), fks);
  const label =
    table.stub && table.schema ? `${table.schema}.${table.name}` : table.name;

  return (
    <div
      data-state={state}
      aria-label={table.stub ? `${label}, in another schema` : label}
      className={cn(
        "bg-card text-card-foreground rounded-surface text-small border shadow-xs transition-opacity motion-reduce:transition-none",
        table.stub && "bg-muted/40 border-dashed",
        state === "selected" && "ring-primary ring-2",
        state === "neighbor" && "ring-primary/50 ring-1",
        state === "dim" && "opacity-25",
        matched && state !== "selected" && "ring-primary ring-2",
      )}
      style={{ width: NODE_WIDTH }}
    >
      <div
        className={cn(
          "relative flex items-center gap-1.5 px-2.5",
          columns.length > 0 && "border-b",
        )}
        style={{ height: HEADER_HEIGHT }}
      >
        <TableIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0",
            table.stub ? "text-muted-foreground" : "text-obj-relation",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-semibold",
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
        <RowHandles column={null} />
      </div>
      {columns.length > 0 && (
        <ul className="py-0.5">
          {columns.map((c) => {
            const fk = fks?.has(c.name);
            return (
              <li
                key={c.name}
                className="relative flex items-center gap-1.5 px-2.5"
                style={{ height: ROW_HEIGHT }}
              >
                <span
                  className="flex w-3.5 shrink-0 justify-center"
                  aria-hidden
                >
                  {c.primary_key ? (
                    <KeyRound className="text-obj-key size-3" />
                  ) : fk ? (
                    <Link2 className="text-obj-relation size-3" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    c.primary_key && "font-medium",
                  )}
                  title={c.name}
                >
                  {c.name}
                  <span className="sr-only">
                    {c.primary_key ? ", primary key" : ""}
                    {fk ? ", foreign key" : ""}
                  </span>
                </span>
                <span
                  className="text-muted-foreground text-caption max-w-24 shrink-0 truncate font-mono"
                  title={`${c.data_type}${c.not_null ? ", not null" : ", nullable"}`}
                >
                  {c.data_type}
                  {!c.not_null && <span aria-label="nullable">?</span>}
                </span>
                <RowHandles column={c.name} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
