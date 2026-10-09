import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { ZoomControls } from "@/shared/components/relation-canvas";
import { useTheme } from "@/shared/theme/theme";
import { CARD_WIDTH, ESTIMATED_HEIGHT } from "./layout";

const PRO_OPTIONS = { hideAttribution: true };

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

type Size = { width: number; height: number };

/** Every node's measured size, fed by React Flow's dimension changes, and
 *  the heights alone for layout. */
export function useNodeSizes<N extends Node>() {
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  const heights = useMemo(
    () =>
      Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, v.height])),
    [sizes],
  );
  const onNodesChange = useCallback((changes: NodeChange<N>[]) => {
    setSizes((cur) => {
      let next = cur;
      for (const c of changes) {
        if (c.type !== "dimensions" || !c.dimensions) continue;
        const old = cur[c.id];
        if (
          old &&
          old.width === c.dimensions.width &&
          old.height === c.dimensions.height
        )
          continue;
        if (next === cur) next = { ...cur };
        next[c.id] = c.dimensions;
      }
      return next;
    });
  }, []);
  return { sizes, heights, onNodesChange };
}

/** Fit the view once, when `ready` first turns true (the first cards have
 *  their real heights). */
export function useFitOnce(ready: boolean) {
  const rf = useReactFlow();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !ready) return;
    fitted.current = true;
    void rf.fitView({ padding: 0.15, maxZoom: 1 });
  }, [ready, rf]);
}

/** Center node `id` each time `nonce` changes, once React Flow has it.
 *  `nodes` retries after a render that adds it. */
export function usePanTo(id: string | null, nonce: number, nodes: unknown) {
  const rf = useReactFlow();
  const panned = useRef(0);
  useEffect(() => {
    if (!id || nonce === panned.current) return;
    const frame = requestAnimationFrame(() => {
      const n = rf.getNode(id);
      if (!n) return;
      panned.current = nonce;
      const w = n.measured?.width ?? CARD_WIDTH;
      const h = n.measured?.height ?? ESTIMATED_HEIGHT;
      void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
        zoom: Math.max(rf.getZoom(), 0.8),
        duration: reducedMotion() ? 0 : 300,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [id, nonce, nodes, rf]);
}

/** The builder canvas: React Flow with dots, the tab's controls floating top
 *  right, and zoom, fit and the history buttons bottom left. Call it inside
 *  a `ReactFlowProvider`. */
export function BuilderFlow<N extends Node, E extends Edge>({
  nodes,
  edges,
  nodeTypes,
  edgeTypes,
  onNodesChange,
  onNodeClick,
  onNodeDrag,
  onNodeDragStop,
  label,
  toolbar,
  history,
  empty,
}: {
  nodes: N[];
  edges: E[];
  nodeTypes: NodeTypes;
  edgeTypes: EdgeTypes;
  onNodesChange: (changes: NodeChange<N>[]) => void;
  onNodeClick?: (node: N) => void;
  onNodeDrag?: OnNodeDrag<N>;
  onNodeDragStop?: OnNodeDrag<N>;
  /** The canvas's accessible name. */
  label: string;
  /** The tab's controls, floating top right on the canvas. */
  toolbar?: ReactNode;
  /** Undo and redo, on top of the zoom stack bottom left. */
  history?: ReactNode;
  /** No cards yet: zoom and fit are off. */
  empty: boolean;
}) {
  const rf = useReactFlow<N, E>();
  const { dark } = useTheme();
  const duration = () => (reducedMotion() ? 0 : 300);
  return (
    <ReactFlow<N, E>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      proOptions={PRO_OPTIONS}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick && ((_, n) => onNodeClick(n))}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      zoomOnDoubleClick={false}
      minZoom={0.2}
      maxZoom={1.5}
      aria-label={label}
      colorMode={dark ? "dark" : "light"}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      {toolbar && (
        // `m-2!` beats React Flow's own 15px panel margin.
        <Panel
          position="top-right"
          className="bg-popover rounded-control m-2! flex max-w-[calc(100%-14rem)] flex-wrap items-center justify-end gap-1.5 border p-0.5 shadow-xs"
        >
          {toolbar}
        </Panel>
      )}
      <ZoomControls
        onZoomIn={() => void rf.zoomIn({ duration: duration() })}
        onZoomOut={() => void rf.zoomOut({ duration: duration() })}
        onFit={() =>
          void rf.fitView({ padding: 0.15, maxZoom: 1, duration: duration() })
        }
        disabled={empty}
        top={history}
      />
    </ReactFlow>
  );
}
