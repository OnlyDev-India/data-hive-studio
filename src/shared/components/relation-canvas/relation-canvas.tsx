import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { Loader2 } from "lucide-react";
import type { GraphTable, SchemaGraph } from "@/shared/api/types";
import { FkEdge } from "./components/fk-edge";
import {
  CanvasTableMenu,
  type CanvasMenuFlags,
  type CanvasMenuState,
} from "./components/canvas-table-menu";
import { TableNode, type TableFlowNode } from "./components/table-node";
import { EntityNode, type EntityFlowNode } from "./components/entity-node";
import {
  RelationshipNode,
  type DiamondFlowNode,
} from "./components/relationship-node";
import { ErEdge } from "./components/er-edge";
import type { Notation } from "./components/notation-toggle";
import { CanvasToolbar } from "./components/canvas-toolbar";
import { CanvasControls } from "./components/canvas-controls";
import { StateOverlay, type CanvasState } from "./components/graph-states";
import {
  adjacency,
  belowZoomFloor,
  fkColumns,
  hopSet,
  shownMode,
  subgraph,
  tableId,
  visibleColumns,
  type ColumnMode,
  type XY,
} from "./lib/graph";
import { NODE_WIDTH } from "./lib/elk-graph";
import {
  buildEdges,
  buildNodes,
  layoutRequest,
  type Highlight,
} from "./lib/flow";
import { layoutGraph } from "./lib/layout";
import { buildErEdges, buildErNodes, useErFlow } from "./lib/use-er-flow";
import { exportDiagram, type ExportFormat } from "./lib/export";
import { useTheme } from "@/shared/theme/theme";
import type { TableAction } from "@/shared/components/table-menu";

type CanvasNode = TableFlowNode | EntityFlowNode | DiamondFlowNode;

const nodeTypes = {
  table: TableNode,
  entity: EntityNode,
  diamond: RelationshipNode,
};
const edgeTypes = { fk: FkEdge, er: ErEdge };
const PRO_OPTIONS = { hideAttribution: true };
const SAVE_DEBOUNCE_MS = 500;
const PLACE_GAP = 160;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Token driven values for React Flow's own structural styles. */
const FLOW_VARS = {
  "--xy-background-pattern-color": "var(--border)",
  "--xy-background-color": "var(--background)",
  "--xy-selection-background-color":
    "color-mix(in oklab, var(--primary) 8%, transparent)",
  "--xy-selection-border": "1px dotted var(--primary)",
  "--xy-attribution-background-color": "transparent",
} as CSSProperties;

export interface RelationCanvasProps {
  graph: SchemaGraph;
  /** Show one table plus its neighbors within `hops`. Laid out fresh, and
   *  never saved. `table` is a table id (`tableId`). */
  focus?: { table: string; hops: number } | null;
  /** Saved positions to start from (full view only). Null = auto layout. */
  saved?: Record<string, XY> | null;
  /** Called after a drag ends, and after new tables were placed. */
  onSave?: (positions: Record<string, XY>) => void;
  onOpen: (table: GraphTable, view: "data" | "schema") => void;
  /** What the right click table menu offers. */
  menu?: CanvasMenuFlags;
  /** A table menu pick. Without it, right click opens no menu. Copy is
   *  handled by the canvas itself. */
  onTableAction?: (table: GraphTable, action: TableAction) => void;
  /** Center on this table id and select it; a new nonce repeats it. */
  reveal?: { id: string; nonce: number } | null;
  hideInferred?: boolean;
  /** File name for exports, without extension. */
  exportName: string;
  /** Host controls shown at the start of the toolbar. */
  toolbar?: ReactNode;
  /** About how wide `toolbar` is, so labels collapse before the row wraps. */
  toolbarStartPx?: number;
  /** Host controls shown at the end of the toolbar. */
  toolbarEnd?: ReactNode;
  /** Render the toolbar into this element (a pane header) instead of a row
   *  above the canvas. Null means the element isn't mounted yet. */
  toolbarHost?: HTMLElement | null;
  /** Host controls after the search box on the canvas. */
  controlsEnd?: ReactNode;
  /** Loading, error or empty, drawn over the canvas. Loading and error
   *  also disable the controls that need a graph. */
  state?: CanvasState | null;
  /** Anything else the host draws over the canvas, such as a picker. */
  overlay?: ReactNode;
  /** More tables are still arriving: place new boxes beside the ones
   *  already drawn, then lay everything out once it turns false. */
  growing?: boolean;
  /** ER view draws the same graph Chen style, laid out fresh each time; it
   *  never reads `saved` or calls `onSave`. */
  notation?: Notation;
  /** A table id ER view never folds into a join diamond, such as a table
   *  tab's own table. The focus table is never folded either. */
  keep?: string;
  /** Called with a message when an export fails or is saved. */
  onNotice?: (
    kind: "success" | "error",
    title: string,
    detail?: string,
  ) => void;
}

/** A relation diagram: tables as boxes, foreign keys as edges, laid out by ELK
 *  in a worker. Both the diagram tab and a table's Diagram mode use it. */
export function RelationCanvas(props: RelationCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  graph,
  focus,
  saved,
  onSave,
  onOpen,
  menu: menuFlags,
  onTableAction,
  reveal,
  hideInferred,
  exportName,
  toolbar,
  toolbarStartPx,
  toolbarEnd,
  toolbarHost,
  controlsEnd,
  state,
  overlay,
  onNotice,
  growing = false,
  notation = "relation",
  keep,
}: RelationCanvasProps) {
  const rf = useReactFlow<CanvasNode>();
  const er = notation === "er";
  // React Flow tags its wrapper light or dark, and the theme tokens follow
  // that class, so it must match the app's own appearance.
  const { dark } = useTheme();
  const wrapper = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ColumnMode>("all");
  const floor = useStore(belowZoomFloor);

  const shownGraph = useMemo(
    () =>
      hideInferred
        ? { ...graph, links: graph.links.filter((l) => !l.inferred) }
        : graph,
    [graph, hideInferred],
  );
  const fullAdj = useMemo(() => adjacency(shownGraph), [shownGraph]);
  const focusTable = focus?.table;
  const focusHops = focus?.hops ?? 1;
  const view = useMemo(
    () =>
      focusTable && fullAdj.has(focusTable)
        ? subgraph(shownGraph, hopSet(fullAdj, focusTable, focusHops))
        : shownGraph,
    [shownGraph, fullAdj, focusTable, focusHops],
  );
  const adj = useMemo(() => adjacency(view), [view]);
  const fks = useMemo(() => fkColumns(graph), [graph]);
  const pinned = !focusTable && saved != null;
  const unfolded = useMemo(
    () => new Set([keep, focusTable].filter((x): x is string => !!x)),
    [keep, focusTable],
  );
  const erFlow = useErFlow(view, mode, fks, er, unfolded);
  const moveEr = erFlow.move;
  const folded = erFlow.model?.folded;
  // The node a table id is drawn as: a folded join table is its diamond in
  // ER, and that diamond is the table again back in Relation view.
  const nodeIdOf = useCallback(
    (id: string) =>
      er ? (folded?.get(id) ?? id) : id.startsWith("j:") ? id.slice(2) : id,
    [er, folded],
  );

  const [positions, setPositions] = useState<Record<string, XY> | null>(null);
  const [layingOut, setLayingOut] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });
  const byId = useMemo(
    () => new Map(view.tables.map((t) => [tableId(t), t])),
    [view],
  );

  const positionsRef = useRef(positions);
  useEffect(() => {
    positionsRef.current = positions;
  });

  useEffect(() => {
    if (er) return;
    let cancelled = false;
    const ids = new Set(view.tables.map(tableId));
    const done = (next: Record<string, XY>, refit: boolean) => {
      if (cancelled) return;
      setPositions(next);
      setLayingOut(false);
      setLayoutError(null);
      if (refit) setFitNonce((n) => n + 1);
    };
    const fail = (e: unknown) => {
      if (cancelled) return;
      setLayingOut(false);
      setLayoutError(e instanceof Error ? e.message : String(e));
    };
    // Keep `from`'s boxes where they are and lay out the rest as a group to
    // the right of them.
    const placeRest = (from: Record<string, XY>) => {
      const base: Record<string, XY> = {};
      for (const [id, p] of Object.entries(from)) if (ids.has(id)) base[id] = p;
      const missing = view.tables.filter((t) => !base[tableId(t)]);
      if (missing.length === 0) return Promise.resolve(base);
      setLayingOut(true);
      const part = subgraph(view, new Set(missing.map(tableId)));
      return layoutGraph(layoutRequest(part, mode, fks)).then((placed) => {
        const xs = Object.values(base);
        const right = xs.length
          ? Math.max(...xs.map((p) => p.x)) + NODE_WIDTH + PLACE_GAP
          : 0;
        const top = xs.length ? Math.min(...xs.map((p) => p.y)) : 0;
        const next = { ...base };
        for (const [id, p] of Object.entries(placed))
          next[id] = { x: p.x + right, y: p.y + top };
        return next;
      });
    };

    const current = positionsRef.current;
    if (pinned && saved) {
      placeRest(saved).then((next) => {
        done(next, false);
        const same =
          Object.keys(next).length === Object.keys(saved).length &&
          Object.keys(next).every((id) => saved[id]);
        if (!same) onSaveRef.current?.(next);
      }, fail);
    } else if (growing && current && Object.keys(current).length > 0) {
      placeRest(current).then((next) => done(next, false), fail);
    } else {
      setLayingOut(true);
      layoutGraph(layoutRequest(view, mode, fks)).then(
        (p) => done(p, true),
        fail,
      );
    }
    return () => {
      cancelled = true;
    };
  }, [view, fks, pinned, saved, mode, growing, er]);
  // What the active view has laid out.
  const shownPositions = er ? erFlow.positions : positions;
  const busyLayout = er ? erFlow.layingOut : layingOut;
  const failedLayout = er ? erFlow.error : layoutError;

  // ---- selection ------------------------------------------------------
  const [selected, setSelected] = useState<string | null>(focusTable ?? null);
  const [flash, setFlash] = useState<string | null>(null);
  const [menu, setMenu] = useState<CanvasMenuState | null>(null);
  const closeMenu = useCallback(
    () => setMenu((m) => (m ? { ...m, open: false } : m)),
    [],
  );
  // Focusing a table selects it. Adjusted during render.
  const [focusedOn, setFocusedOn] = useState(focusTable);
  if (focusedOn !== focusTable) {
    setFocusedOn(focusTable);
    setSelected(focusTable ?? null);
  }
  const [exporting, setExporting] = useState(false);
  const shownAdj = er ? erFlow.adj : adj;
  const hl: Highlight | null = useMemo(() => {
    const sel = selected ? nodeIdOf(selected) : null;
    return sel && !exporting && shownAdj?.has(sel)
      ? { selected: sel, neighbors: shownAdj.get(sel) ?? new Set() }
      : null;
  }, [selected, shownAdj, exporting, nodeIdOf]);

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const erModel = erFlow.model;
  useEffect(() => {
    if (er)
      setNodes(
        erModel && shownPositions
          ? buildErNodes(erModel, shownPositions, fks, hl, flash)
          : [],
      );
    else
      setNodes(
        shownPositions
          ? buildNodes(view, shownPositions, mode, fks, hl, flash)
          : [],
      );
  }, [er, erModel, view, shownPositions, mode, fks, hl, flash, setNodes]);

  const effective = shownMode(mode, floor);
  const shown = useCallback(
    (id: string) => {
      const t = byId.get(id);
      return new Set(
        t ? visibleColumns(t, effective, fks.get(id)).map((c) => c.name) : [],
      );
    },
    [byId, effective, fks],
  );
  const edges = useMemo(
    () =>
      !shownPositions
        ? []
        : er
          ? erModel
            ? buildErEdges(erModel, shownPositions, hl)
            : []
          : buildEdges(view, shownPositions, shown, hl),
    [er, erModel, view, shownPositions, shown, hl],
  );

  // ---- viewport -------------------------------------------------------
  const duration = () => (reducedMotion() ? 0 : 300);

  const center = useCallback(
    (table: string) => {
      const id = nodeIdOf(table);
      const n = rf.getNode(id);
      if (!n) return false;
      const w = n.measured?.width ?? NODE_WIDTH;
      const h = n.measured?.height ?? 120;
      void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, {
        zoom: Math.max(rf.getZoom(), 0.9),
        duration: duration(),
      });
      setSelected(id);
      setFlash(id);
      return true;
    },
    [rf, nodeIdOf],
  );

  const revealId = reveal?.id;
  const revealNonce = reveal?.nonce;
  const revealed = useRef<number | null>(null);
  // A fresh layout fits the view, unless a reveal is about to center it.
  const fitKey = er ? erFlow.fitNonce : fitNonce;
  useEffect(() => {
    if (fitKey === 0) return;
    if (revealId && revealNonce != null && revealed.current !== revealNonce)
      return;
    const id = requestAnimationFrame(() => {
      void rf.fitView({ padding: 0.12, duration: duration(), maxZoom: 1 });
    });
    return () => cancelAnimationFrame(id);
  }, [fitKey, rf, revealId, revealNonce]);
  useEffect(() => {
    if (!revealId || revealNonce == null || revealed.current === revealNonce)
      return;
    if (!shownPositions?.[nodeIdOf(revealId)]) return;
    const frame = requestAnimationFrame(() => {
      if (center(revealId)) revealed.current = revealNonce;
    });
    return () => cancelAnimationFrame(frame);
  }, [revealId, revealNonce, shownPositions, nodes, center, nodeIdOf]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  // ---- saving drags ---------------------------------------------------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );
  const onNodeDragStop = useCallback(() => {
    const live: Record<string, XY> = {};
    for (const n of rf.getNodes())
      live[n.id] = { x: n.position.x, y: n.position.y };
    // An ER drag lasts until the next fresh layout and is never saved.
    if (er) {
      moveEr(live);
      return;
    }
    setPositions((p) => ({ ...(p ?? {}), ...live }));
    if (focusTable || !onSaveRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(
      () => onSaveRef.current?.(live),
      SAVE_DEBOUNCE_MS,
    );
  }, [rf, focusTable, er, moveEr]);

  // ---- open / menu ----------------------------------------------------
  const tableOf = useCallback((id: string) => byId.get(id), [byId]);
  // Double click and Enter: a table's own node, or the table a diamond opens.
  const openable = (id: string) =>
    tableOf(id) ?? erModel?.diamonds.find((d) => d.id === id)?.opens;
  const onNodeClick: NodeMouseHandler<CanvasNode> = (_, n) => {
    closeMenu();
    setSelected(n.id);
  };
  const onNodeDoubleClick: NodeMouseHandler<CanvasNode> = (_, n) => {
    const t = openable(n.id);
    if (t) onOpen(t, "data");
  };
  const onNodeContextMenu: NodeMouseHandler<CanvasNode> = (e, n) => {
    e.preventDefault();
    if (!onTableAction) return;
    if ((e.target as HTMLElement).closest("[data-oval]")) return;
    // A link diamond opens nothing; a folded join table acts on its table.
    const t = n.id.startsWith("j:")
      ? erModel?.diamonds.find((d) => d.id === n.id)?.opens
      : tableOf(n.id);
    if (!t) return;
    setSelected(n.id);
    setMenu({ table: t, x: e.clientX, y: e.clientY, open: true });
  };
  const pickAction = (action: TableAction) => {
    const t = menu?.table;
    closeMenu();
    if (!t) return;
    if (action === "copy") void copyName(t.name);
    else onTableAction?.(t, action);
  };
  const copyName = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
      onNotice?.("success", "Name copied", name);
    } catch (e) {
      onNotice?.("error", "Couldn't copy the name", String(e));
    }
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, [role=menu]")) return;
    if (e.key === "Escape") {
      setSelected(null);
      closeMenu();
    } else if (e.key === "Enter" && selected) {
      const t = openable(selected);
      if (t) onOpen(t, "data");
    }
  };

  // ---- export ---------------------------------------------------------
  const runExport = async (format: ExportFormat) => {
    setExporting(true);
    // Every box must be in the DOM, not only the ones on screen, and drawn
    // without the selection's dimming.
    await new Promise((r) => setTimeout(r, 120));
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    try {
      const path = await exportDiagram(rf, wrapper.current, format, exportName);
      if (path)
        onNotice?.(
          "success",
          `Diagram exported as ${format.toUpperCase()}`,
          path,
        );
    } catch (e) {
      onNotice?.(
        "error",
        "Export failed",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setExporting(false);
    }
  };

  const busy = busyLayout && !shownPositions && !state;
  const noGraph = state?.kind === "loading" || state?.kind === "error";
  // Nothing drawn: loading, error, empty, or the host's table picker.
  const nothingDrawn = !!state || view.tables.length === 0;

  const bar = (
    <CanvasToolbar
      paneRef={wrapper}
      start={toolbar}
      startPx={toolbarStartPx}
      end={toolbarEnd}
      bare={toolbarHost !== undefined}
      onExport={(f) => void runExport(f)}
      exporting={exporting}
      canExport={!!shownPositions && view.tables.length > 0}
      disabled={noGraph}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kept beside the wrapper in the React tree, portal or not, so keys on
          its buttons never bubble to the wrapper's onKeyDown. */}
      {toolbarHost === undefined
        ? bar
        : toolbarHost
          ? createPortal(bar, toolbarHost)
          : null}
      <div
        ref={wrapper}
        className="bg-background relative min-h-0 flex-1 outline-none"
        style={FLOW_VARS}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          proOptions={PRO_OPTIONS}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeContextMenu={onNodeContextMenu}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => {
            setSelected(null);
            closeMenu();
          }}
          onMoveStart={closeMenu}
          onlyRenderVisibleElements={!exporting}
          nodesConnectable={false}
          edgesFocusable={false}
          elementsSelectable
          zoomOnDoubleClick={false}
          minZoom={0.05}
          maxZoom={2}
          aria-label="Relation diagram"
          colorMode={dark ? "dark" : "light"}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <CanvasControls
            mode={mode}
            onMode={setMode}
            graph={view}
            onPick={(t) => center(tableId(t))}
            onZoomIn={() => void rf.zoomIn({ duration: duration() })}
            onZoomOut={() => void rf.zoomOut({ duration: duration() })}
            onFit={() =>
              void rf.fitView({ padding: 0.12, duration: duration() })
            }
            end={controlsEnd}
            disabled={nothingDrawn}
          />
        </ReactFlow>
        {busy && (
          <div
            role="status"
            className="text-muted-foreground text-small absolute inset-0 flex items-center justify-center gap-2"
          >
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            Laying out {view.tables.length}{" "}
            {view.tables.length === 1 ? "table" : "tables"}…
          </div>
        )}
        {busyLayout && shownPositions && (
          <div
            role="status"
            className="bg-popover text-muted-foreground rounded-control text-caption absolute top-2 right-2 flex items-center gap-1.5 border px-2 py-1 shadow-xs"
          >
            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
            Laying out…
          </div>
        )}
        {failedLayout && (
          <div
            role="alert"
            className="text-destructive text-small absolute inset-0 flex items-center justify-center p-6 text-center"
          >
            The layout failed: {failedLayout}
          </div>
        )}
        {state && <StateOverlay state={state} />}
        {overlay}
        {menu && menuFlags && (
          <CanvasTableMenu
            state={menu}
            flags={menuFlags}
            onPick={pickAction}
            onClose={closeMenu}
            returnFocus={wrapper}
          />
        )}
      </div>
    </div>
  );
}
