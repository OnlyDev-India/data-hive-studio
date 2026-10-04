import { useCallback, useEffect, useMemo, useState } from "react";
import type { SchemaGraph } from "@/shared/api/types";
import type { EntityFlowNode } from "../components/entity-node";
import { entityHandle } from "../components/entity-node";
import type { ErFlowEdge } from "../components/er-edge";
import {
  diamondHandle,
  type DiamondFlowNode,
  type DiamondSide,
} from "../components/relationship-node";
import type { HighlightState } from "../components/table-node";
import type { Highlight } from "./flow";
import type { ColumnMode, XY } from "./graph";
import { layoutGraph } from "./layout";
import {
  buildErModel,
  erAdjacency,
  erLayoutRequest,
  type ErModel,
} from "./er-model";

function stateOf(id: string, hl: Highlight | null): HighlightState {
  if (!hl) return undefined;
  if (id === hl.selected) return "selected";
  return hl.neighbors.has(id) ? "neighbor" : "dim";
}

export function buildErNodes(
  model: ErModel,
  positions: Record<string, XY>,
  fks: Map<string, Set<string>>,
  hl: Highlight | null,
  matched: string | null,
): (EntityFlowNode | DiamondFlowNode)[] {
  const out: (EntityFlowNode | DiamondFlowNode)[] = [];
  for (const e of model.entities) {
    const position = positions[e.id];
    if (!position) continue;
    out.push({
      id: e.id,
      type: "entity",
      position,
      width: e.geometry.width,
      height: e.geometry.height,
      data: {
        table: e.table,
        geometry: e.geometry,
        fks: fks.get(e.id),
        state: stateOf(e.id, hl),
        matched: matched === e.id,
      },
    });
  }
  for (const d of model.diamonds) {
    const position = positions[d.id];
    if (!position) continue;
    out.push({
      id: d.id,
      type: "diamond",
      position,
      width: d.width,
      height: d.height,
      data: { diamond: d, state: stateOf(d.id, hl) },
    });
  }
  return out;
}

/** Each line runs from the diamond point facing its entity to the entity
 *  rectangle's facing side. A self link leaves from the top and bottom
 *  points so its two lines stay apart. */
export function buildErEdges(
  model: ErModel,
  positions: Record<string, XY>,
  hl: Highlight | null,
): ErFlowEdge[] {
  const center = new Map<string, number>();
  for (const e of model.entities)
    if (positions[e.id])
      center.set(e.id, positions[e.id].x + e.geometry.width / 2);
  for (const d of model.diamonds)
    if (positions[d.id]) center.set(d.id, positions[d.id].x + d.width / 2);
  const ends = new Map<string, Set<string>>();
  for (const l of model.lines)
    ends.set(l.diamond, (ends.get(l.diamond) ?? new Set()).add(l.entity));

  const out: ErFlowEdge[] = [];
  for (const l of model.lines) {
    const dx = center.get(l.diamond);
    const ex = center.get(l.entity);
    if (dx == null || ex == null) continue;
    const self = ends.get(l.diamond)?.size === 1;
    const right = ex >= dx;
    const side: DiamondSide = self
      ? l.end === "from"
        ? "t"
        : "b"
      : right
        ? "r"
        : "l";
    const lit =
      !!hl && (l.diamond === hl.selected || hl.neighbors.has(l.diamond));
    const state: HighlightState = !hl ? undefined : lit ? "neighbor" : "dim";
    out.push({
      id: l.id,
      type: "er",
      source: l.diamond,
      target: l.entity,
      sourceHandle: diamondHandle(side),
      targetHandle: entityHandle(right ? "l" : "r"),
      zIndex: lit ? 1 : 0,
      data: { mark: l.mark, inferred: l.inferred, state },
    });
  }
  return out;
}

/** The ER drawing of `graph`, laid out fresh by ELK whenever the graph or
 *  the column toggle changes, and never saved. Idle while `enabled` is off.
 *  Tables in `keep` are never folded into a join diamond. */
export function useErFlow(
  graph: SchemaGraph,
  mode: ColumnMode,
  fks: Map<string, Set<string>>,
  enabled: boolean,
  keep: ReadonlySet<string>,
) {
  const model = useMemo(
    () => (enabled ? buildErModel(graph, mode, fks, keep) : null),
    [enabled, graph, mode, fks, keep],
  );
  // A result counts only for the model it was laid out from, so a new model
  // reads as "laying out" with nothing to reset.
  const [result, setResult] = useState<{
    model: ErModel;
    positions: Record<string, XY> | null;
    error: string | null;
  } | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    layoutGraph(erLayoutRequest(model)).then(
      (positions) => {
        if (cancelled) return;
        setResult({ model, positions, error: null });
        setFitNonce((n) => n + 1);
      },
      (e: unknown) => {
        if (cancelled) return;
        const error = e instanceof Error ? e.message : String(e);
        setResult({ model, positions: null, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [model]);

  const current = model && result?.model === model ? result : null;
  /** Keeps a drag until the next fresh layout. */
  const move = useCallback(
    (moved: Record<string, XY>) =>
      setResult((r) =>
        r?.positions ? { ...r, positions: { ...r.positions, ...moved } } : r,
      ),
    [],
  );
  const adj = useMemo(() => (model ? erAdjacency(model) : null), [model]);
  return {
    model,
    adj,
    positions: current?.positions ?? null,
    move,
    layingOut: !!model && !current,
    error: current?.error ?? null,
    fitNonce,
  };
}
