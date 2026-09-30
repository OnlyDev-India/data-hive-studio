import { MarkerType } from "@xyflow/react";
import type { SchemaGraph } from "@/shared/api/types";
import type { FkFlowEdge } from "../components/fk-edge";
import {
  handleId,
  type HighlightState,
  type TableFlowNode,
} from "../components/table-node";
import {
  endpointResolver,
  tableId,
  visibleColumns,
  type ColumnMode,
  type XY,
} from "./graph";
import { NODE_WIDTH, nodeHeight, type LayoutRequest } from "./elk-graph";

/** What the selection lights up: the selected box, its direct neighbors,
 *  and the links between them. */
export interface Highlight {
  selected: string;
  neighbors: Set<string>;
}

export function layoutRequest(
  graph: SchemaGraph,
  mode: ColumnMode,
  fks: Map<string, Set<string>>,
): LayoutRequest {
  const resolve = endpointResolver(graph);
  const shown = new Map<string, Set<string>>();
  const nodes = graph.tables.map((t) => {
    const id = tableId(t);
    const cols = visibleColumns(t, mode, fks.get(id)).map((c) => c.name);
    shown.set(id, new Set(cols));
    return {
      id,
      width: NODE_WIDTH,
      height: nodeHeight(cols.length),
      ports: cols,
    };
  });
  const edges = graph.links.flatMap((l) => {
    const { from, to } = resolve(l);
    if (!from || !to) return [];
    const sp = l.from_columns[0];
    const tp = l.to_columns[0];
    return [
      {
        id: l.id,
        source: from,
        sourcePort: sp && shown.get(from)?.has(sp) ? sp : null,
        target: to,
        targetPort: tp && shown.get(to)?.has(tp) ? tp : null,
      },
    ];
  });
  return { nodes, edges };
}

function stateOf(id: string, hl: Highlight | null): HighlightState {
  if (!hl) return undefined;
  if (id === hl.selected) return "selected";
  return hl.neighbors.has(id) ? "neighbor" : "dim";
}

export function buildNodes(
  graph: SchemaGraph,
  positions: Record<string, XY>,
  mode: ColumnMode,
  fks: Map<string, Set<string>>,
  hl: Highlight | null,
  matched: string | null,
): TableFlowNode[] {
  return graph.tables.flatMap((t) => {
    const id = tableId(t);
    const position = positions[id];
    if (!position) return [];
    return [
      {
        id,
        type: "table" as const,
        position,
        width: NODE_WIDTH,
        data: {
          table: t,
          fks: fks.get(id),
          mode,
          state: stateOf(id, hl),
          matched: matched === id,
        },
      },
    ];
  });
}

/** One edge per link, attached to the first key column's row when the box
 *  shows it (else the header), on whichever sides face each other. */
export function buildEdges(
  graph: SchemaGraph,
  positions: Record<string, XY>,
  shown: (id: string) => Set<string>,
  hl: Highlight | null,
): FkFlowEdge[] {
  const resolve = endpointResolver(graph);
  const pairs = new Map<string, number>();
  const out: FkFlowEdge[] = [];
  for (const l of graph.links) {
    const { from, to } = resolve(l);
    if (!from || !to) continue;
    const a = positions[from];
    const b = positions[to];
    if (!a || !b) continue;
    const pair = from < to ? `${from}\u0000${to}` : `${to}\u0000${from}`;
    const parallel = pairs.get(pair) ?? 0;
    pairs.set(pair, parallel + 1);
    const self = from === to;
    const forward = b.x >= a.x;
    const sSide = self || forward ? "r" : "l";
    const tSide = self ? "r" : forward ? "l" : "r";
    const sCol = l.from_columns[0];
    const tCol = l.to_columns[0];
    const lit =
      !!hl &&
      (from === hl.selected || to === hl.selected) &&
      (from === to || hl.neighbors.has(from) || hl.neighbors.has(to));
    const state: HighlightState = !hl ? undefined : lit ? "neighbor" : "dim";
    out.push({
      id: l.id,
      type: "fk",
      source: from,
      target: to,
      sourceHandle: handleId(
        sCol && shown(from).has(sCol) ? sCol : null,
        "s",
        sSide,
      ),
      targetHandle: handleId(
        tCol && shown(to).has(tCol) ? tCol : null,
        "t",
        tSide,
      ),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color:
          state === "neighbor" ? "var(--primary)" : "var(--muted-foreground)",
      },
      zIndex: state === "neighbor" ? 1 : 0,
      data: { link: l, parallel, state },
    });
  }
  return out;
}
