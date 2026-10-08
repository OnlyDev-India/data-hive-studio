import { useMemo, useState, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Blocks } from "lucide-react";
import {
  AddCard,
  AddMenuContext,
  BuilderFlow,
  chainLayout,
  dragSlot,
  InsertLink,
  MAIN_ADD,
  useFitOnce,
  useNodeSizes,
  type AddCardNode,
  type AddMenu,
  type CardFault,
  type InsertEdge,
  type XY,
} from "@/shared/components/builder-canvas";
import { DiagramEmpty } from "@/shared/components/relation-canvas";
import type { Clause } from "@/shared/store";
import {
  ClauseActionsContext,
  ColumnsContext,
  TablesContext,
  type ClauseActions,
  type Tables,
} from "../lib/card-actions";
import type { Column } from "../lib/columns";
import { moveJoin, slotKinds } from "../lib/model";
import type { Dialect } from "../lib/sql-text";
import type { ClausePreview } from "../lib/use-sql-previews";
import { AddClauseMenu } from "./add-clause-menu";
import { ClauseCard, type ClauseCardNode } from "./clause-card";

type FlowNode = ClauseCardNode | AddCardNode;

const nodeTypes = { clause: ClauseCard, add: AddCard };
const edgeTypes = { insert: InsertLink };

export interface QueryCanvasProps {
  clauses: Clause[];
  selectedId: string | null;
  previews: Record<string, ClausePreview>;
  faults: Record<string, CardFault>;
  skipped: Set<string>;
  columns: Record<string, Column[]>;
  tables: Tables;
  cap: number;
  sampled: boolean;
  dialect: Dialect;
  actions: ClauseActions;
  toolbar?: ReactNode;
  history?: ReactNode;
}

export function QueryCanvas(props: QueryCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

interface Drag {
  id: string;
  at: XY;
  slot: number;
}

function CanvasInner({
  clauses,
  selectedId,
  previews,
  faults,
  skipped,
  columns,
  tables,
  cap,
  sampled,
  dialect,
  actions,
  toolbar,
  history,
}: QueryCanvasProps) {
  const { sizes, heights, onNodesChange } = useNodeSizes<FlowNode>();
  const [drag, setDrag] = useState<Drag | null>(null);
  const settled = useMemo(
    () =>
      chainLayout(
        clauses.map((c) => c.id),
        heights,
      ),
    [clauses, heights],
  );
  const joins = clauses.filter((c) => c.kind === "join").map((c) => c.id);

  // While a JOIN is dragged the other JOINs make room at the slot it would
  // take.
  const shown = useMemo(
    () => (drag ? moveJoin(clauses, drag.id, drag.slot) : clauses),
    [clauses, drag],
  );
  const can_append = slotKinds(clauses, clauses.length).length > 0;

  const nodes = useMemo<FlowNode[]>(() => {
    const ids = shown.map((c) => c.id);
    const { cards, add } = chainLayout(ids, heights);
    const measured = (id: string) => (sizes[id] ? { measured: sizes[id] } : {});
    const out: FlowNode[] = shown.map((c, i) => ({
      id: c.id,
      type: "clause",
      position: drag?.id === c.id ? drag.at : cards[c.id],
      selected: c.id === selectedId,
      draggable: c.kind === "join",
      // React Flow marks only draggable nodes nopan; without it the pane
      // swallows mousedown and the card's menus never open.
      className: c.kind === "join" ? undefined : "nopan",
      dragHandle: ".clause-drag",
      ...measured(c.id),
      data: {
        clause: c,
        ordinal: i + 1,
        preview: previews[c.id],
        fault: faults[c.id],
        skipped: skipped.has(c.id),
        cap,
        sampled,
        dialect,
      },
    }));
    if (can_append)
      out.push({
        id: MAIN_ADD,
        type: "add",
        position: add,
        selectable: false,
        draggable: false,
        ...measured(MAIN_ADD),
        data: { index: shown.length },
      });
    return out;
  }, [
    shown,
    heights,
    sizes,
    drag,
    selectedId,
    previews,
    faults,
    skipped,
    cap,
    sampled,
    dialect,
    can_append,
  ]);

  const edges = useMemo<InsertEdge[]>(() => {
    const ids = clauses.map((c) => c.id);
    if (can_append) ids.push(MAIN_ADD);
    const out: InsertEdge[] = [];
    for (let k = 0; k + 1 < ids.length; k++) {
      const index = k + 1;
      const plus =
        !drag && index < clauses.length && slotKinds(clauses, index).length > 0;
      out.push({
        id: `${ids[k]}->${ids[k + 1]}`,
        type: "insert",
        source: ids[k],
        target: ids[k + 1],
        selectable: false,
        focusable: false,
        ...(plus ? { data: { index } } : {}),
      });
    }
    return out;
  }, [clauses, drag, can_append]);

  const addMenu = useMemo<AddMenu>(
    () => ({
      noun: "clause",
      render: (place, trigger) => (
        <AddClauseMenu
          kinds={slotKinds(clauses, place.index)}
          trigger={trigger}
          onPick={(kind) => actions.insert(place.index, kind)}
        />
      ),
    }),
    [clauses, actions],
  );

  /** The slot JOIN `id` dragged to `at` takes among the JOINs. */
  const slotFor = (id: string, at: XY) =>
    dragSlot(
      joins.filter((j) => j !== id),
      settled.cards,
      heights,
      at.y,
      heights[id] ?? 0,
    );

  useFitOnce(clauses.length > 0 && clauses.every((c) => sizes[c.id]));

  return (
    <ClauseActionsContext.Provider value={actions}>
      <AddMenuContext.Provider value={addMenu}>
        <ColumnsContext.Provider value={columns}>
          <TablesContext.Provider value={tables}>
            <div className="relative h-full w-full">
              <BuilderFlow<FlowNode, InsertEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeClick={(n) => {
                  if (n.type === "clause") actions.select(n.id);
                }}
                onNodeDrag={(_, n) => {
                  if (n.type !== "clause") return;
                  setDrag({
                    id: n.id,
                    at: n.position,
                    slot: slotFor(n.id, n.position),
                  });
                }}
                onNodeDragStop={(_, n) => {
                  if (n.type !== "clause") return;
                  const slot = slotFor(n.id, n.position);
                  setDrag(null);
                  actions.moveJoin(n.id, slot);
                }}
                label="Query builder"
                empty={clauses.length === 0}
                toolbar={toolbar}
                history={history}
              />
              {clauses.length === 0 && (
                <DiagramEmpty
                  title="Build a query"
                  icon={<Blocks className="text-muted-foreground size-6" />}
                  description="Start from a table, then add joins, filters and groups. Every card shows the rows after it, run on the first rows of the table."
                />
              )}
            </div>
          </TablesContext.Provider>
        </ColumnsContext.Provider>
      </AddMenuContext.Provider>
    </ClauseActionsContext.Provider>
  );
}
