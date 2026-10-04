import type { XY } from "./graph";

export const NODE_WIDTH = 248;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 24;
const BODY_PAD = 4;

export function nodeHeight(rows: number): number {
  return HEADER_HEIGHT + rows * ROW_HEIGHT + (rows > 0 ? BODY_PAD : 0);
}

/** One box to place; `ports` are its visible column names in order, or
 *  null for a box whose edges may attach anywhere (ER view). */
export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  ports: string[] | null;
}

/** `null` port = the box's header. Ignored on a box without ports. */
export interface LayoutEdge {
  id: string;
  source: string;
  sourcePort: string | null;
  target: string;
  targetPort: string | null;
}

export interface LayoutRequest {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export type LayoutResult = Record<string, XY>;

export const portId = (
  node: string,
  column: string | null,
  side: "in" | "out",
) => `${node}\u0001${column ?? ""}\u0001${side}`;

interface ElkPort {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}

/** The ELK input: layered, left to right, orthogonal edges, one port per
 *  column on each side in a fixed order. ELK numbers ports clockwise from
 *  the top left, so east ports count down the box and west ports up it. */
export function toElkGraph(req: LayoutRequest) {
  const free = new Set(req.nodes.filter((n) => !n.ports).map((n) => n.id));
  const end = (node: string, column: string | null, side: "in" | "out") =>
    free.has(node) ? node : portId(node, column, side);
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "96",
      "elk.spacing.componentComponent": "64",
      "elk.aspectRatio": "1.6",
    },
    children: req.nodes.map((n) => {
      if (!n.ports)
        return {
          id: n.id,
          width: n.width,
          height: n.height,
          layoutOptions: { "elk.portConstraints": "FREE" },
        };
      const rows = [null, ...n.ports];
      const east: ElkPort[] = rows.map((c, i) => ({
        id: portId(n.id, c, "out"),
        width: 1,
        height: 1,
        layoutOptions: { "elk.port.side": "EAST", "elk.port.index": String(i) },
      }));
      const west: ElkPort[] = rows.map((c, i) => ({
        id: portId(n.id, c, "in"),
        width: 1,
        height: 1,
        layoutOptions: {
          "elk.port.side": "WEST",
          "elk.port.index": String(2 * rows.length - 1 - i),
        },
      }));
      return {
        id: n.id,
        width: n.width,
        height: n.height,
        layoutOptions: { "elk.portConstraints": "FIXED_ORDER" },
        ports: [...east, ...west],
      };
    }),
    edges: req.edges.map((e) => ({
      id: e.id,
      sources: [end(e.source, e.sourcePort, "out")],
      targets: [end(e.target, e.targetPort, "in")],
    })),
  };
}

export function positionsOf(out: {
  children?: { id: string; x?: number; y?: number }[];
}): LayoutResult {
  const res: LayoutResult = {};
  for (const c of out.children ?? []) res[c.id] = { x: c.x ?? 0, y: c.y ?? 0 };
  return res;
}
