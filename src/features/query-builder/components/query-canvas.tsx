import { useMemo, useState, type ReactNode } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Blocks, Plus } from "lucide-react";
import {
  AddCard,
  AddMenuContext,
  BuilderFlow,
  dragSlot,
  InsertLink,
  useFitOnce,
  useNodeSizes,
  usePanTo,
  type AddCardNode,
  type AddMenu,
  type CardFault,
  type InsertEdge,
  type XY,
} from "@/shared/components/builder-canvas";
import { DiagramEmpty } from "@/shared/components/relation-canvas";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import type { BuilderQuery, Clause } from "@/shared/store";
import {
  ClauseActionsContext,
  ColumnsContext,
  QueryActionsContext,
  TablesContext,
  type ClauseActions,
  type QueryActions,
  type Tables,
} from "../lib/card-actions";
import type { Column } from "../lib/columns";
import { chainSummary, roleOf } from "../lib/chains";
import {
  ADD_QUERY,
  addId,
  chainHeadId,
  headerId,
  laneSlot,
  lanesLayout,
} from "../lib/lanes";
import {
  canRemove,
  CLAUSE_LABEL,
  endKinds,
  findChain,
  isWrite,
  listOf,
  mapListOf,
  moveJoin,
  moveQuery,
  parentOf,
  queryBadge,
  queryLabel,
  queryOf,
  REPEATS,
  slotFor,
  slotKinds,
  type ListRole,
} from "../lib/model";
import { readCte, readSetOp, type Dialect } from "../lib/sql-text";
import type { ClausePreview } from "../lib/use-sql-previews";
import { AddClauseMenu } from "./add-clause-menu";
import { AddQueryMenu } from "./add-query-menu";
import {
  ChainHead,
  ChainLink,
  type ChainEdge,
  type ChainHeadNode,
} from "./chain-head";
import { ClauseCard, type ClauseCardNode } from "./clause-card";
import { StatementCard, type StatementCardNode } from "./statement-card";
import {
  AddQuery,
  QueryColumnHeader,
  type AddQueryNode,
  type QueryHeaderNode,
} from "./query-column";

type FlowNode =
  | ClauseCardNode
  | StatementCardNode
  | AddCardNode
  | QueryHeaderNode
  | AddQueryNode
  | ChainHeadNode;

type FlowEdge = InsertEdge | ChainEdge;

const nodeTypes = {
  clause: ClauseCard,
  statement: StatementCard,
  add: AddCard,
  query: QueryColumnHeader,
  "add-query": AddQuery,
  chain: ChainHead,
};
const edgeTypes = { insert: InsertLink, chain: ChainLink };

/** One card list on the canvas: a query's, or a chain's. */
interface ListView {
  id: string;
  query: BuilderQuery;
  clauses: Clause[];
  role: ListRole;
  /** The chain's head, for a chain. */
  head: string | null;
}

/** Every list of every query, outer ones first; collapsed chains' lists
 *  are left out. */
function listsOf(queries: BuilderQuery[]): ListView[] {
  const out: ListView[] = [];
  const walk = (q: BuilderQuery, clauses: Clause[]) => {
    for (const c of clauses)
      for (const ch of c.chains ?? []) {
        if (ch.collapsed) continue;
        out.push({
          id: ch.id,
          query: q,
          clauses: ch.clauses,
          role: roleOf(c.kind),
          head: chainHeadId(ch.id),
        });
        walk(q, ch.clauses);
      }
  };
  for (const q of queries) {
    out.push({
      id: q.id,
      query: q,
      clauses: q.clauses,
      role: "query",
      head: null,
    });
    walk(q, q.clauses);
  }
  return out;
}

/** What a chain is to the card it hangs off. */
function chainTitle(parent: Clause, ordinal: number): string {
  if (parent.kind === "cte")
    return `${readCte(parent.body)?.name ?? "The CTE"} is`;
  if (parent.kind === "compound")
    return `${readSetOp(parent.body) ?? "UNION"} with`;
  return `Subquery in ${CLAUSE_LABEL[parent.kind]}, card ${ordinal}`;
}

export interface QueryCanvasProps {
  queries: BuilderQuery[];
  picked: string[];
  /** The query that previews; every other query's previews are stale. */
  currentId: string | null;
  selectedId: string | null;
  previews: Record<string, ClausePreview>;
  faults: Record<string, CardFault>;
  skipped: Set<string>;
  /** Cards holding a bind variable. */
  binds: Set<string>;
  /** Queries holding a card error. */
  broken: Set<string>;
  /** Chains that read the outer row, so never preview on their own. */
  outer: Set<string>;
  columns: Record<string, Column[]>;
  tables: Tables;
  cap: number;
  sampled: boolean;
  dialect: Dialect;
  actions: ClauseActions;
  queryActions: QueryActions;
  toolbar?: ReactNode;
  history?: ReactNode;
  /** A search in the toolbar, null while its box is empty. */
  search: CanvasSearch | null;
}

/** How a search marks the canvas. */
export interface CanvasSearch {
  /** Queries with no match. */
  dim: Set<string>;
  /** Matching header and card node ids. */
  hits: Set<string>;
  /** The match to pan to, again each time `nonce` changes. */
  focus: string | null;
  nonce: number;
}

export function QueryCanvas(props: QueryCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/** A JOIN, CTE or set operation card, or a query header, being dragged,
 *  and the slot it would take. */
type Drag =
  | { what: "join"; query: string; id: string; at: XY; slot: number }
  | { what: "query"; id: string; at: XY; slot: number };

function CanvasInner({
  queries,
  picked,
  currentId,
  selectedId,
  previews,
  faults,
  skipped,
  binds,
  broken,
  outer,
  columns,
  tables,
  cap,
  sampled,
  dialect,
  actions,
  queryActions,
  toolbar,
  history,
  search,
}: QueryCanvasProps) {
  const { sizes, heights, onNodesChange } = useNodeSizes<FlowNode>();
  const [drag, setDrag] = useState<Drag | null>(null);
  const hasAdd = useMemo(() => {
    const lists = new Map(listsOf(queries).map((l) => [l.id, l]));
    return (id: string) => {
      const l = lists.get(id);
      return !!l && endKinds(l.clauses, dialect, l.role).length > 0;
    };
  }, [queries, dialect]);
  const settled = useMemo(
    () =>
      lanesLayout(
        queries.map((q) => ({ id: q.id, clauses: q.clauses })),
        heights,
        hasAdd,
      ),
    [queries, heights, hasAdd],
  );

  // While a card or a header is dragged, the others make room at the slot
  // it would take.
  const shown = useMemo(() => {
    if (!drag) return queries;
    if (drag.what === "query") return moveQuery(queries, drag.id, drag.slot);
    return queries.map((q) =>
      q.id === drag.query
        ? {
            ...q,
            clauses: mapListOf(q.clauses, drag.id, (cl) =>
              moveJoin(cl, drag.id, drag.slot),
            ),
          }
        : q,
    );
  }, [queries, drag]);

  const nodes = useMemo<FlowNode[]>(() => {
    const at = lanesLayout(
      shown.map((q) => ({ id: q.id, clauses: q.clauses })),
      heights,
      hasAdd,
    );
    const measured = (id: string) => (sizes[id] ? { measured: sizes[id] } : {});
    // Queries with no match fade; matches get an outline, the current one
    // stronger.
    const look = (query: string, id: string | null, base?: string) =>
      cn(
        base,
        search?.dim.has(query) && "opacity-40",
        id !== null &&
          search?.hits.has(id) &&
          "rounded-surface outline-2 outline-offset-2",
        id !== null &&
          search?.hits.has(id) &&
          (id === search?.focus ? "outline-primary" : "outline-primary/40"),
      ) || undefined;
    const out: FlowNode[] = [];
    for (const q of shown) {
      const hid = headerId(q.id);
      out.push({
        id: hid,
        type: "query",
        position:
          drag?.what === "query" && drag.id === q.id
            ? drag.at
            : at.headers[q.id],
        selectable: false,
        dragHandle: ".query-drag",
        className: look(q.id, hid),
        ...measured(hid),
        data: {
          query: q.id,
          label: queryLabel(q),
          name: q.name,
          kind: queryBadge(q),
          picked: picked.includes(q.id),
          current: q.id === currentId,
          broken: broken.has(q.id),
        },
      });
    }
    for (const l of listsOf(shown)) {
      const q = l.query;
      const stale = q.id !== currentId;
      const write = isWrite(q.kind) && l.role === "query";
      const outerRow = l.head !== null && outer.has(l.id);
      l.clauses.forEach((c, i) => {
        if (c.kind === "statement") {
          out.push({
            id: c.id,
            type: "statement",
            position: at.at[c.id],
            selected: c.id === selectedId,
            draggable: false,
            className: look(q.id, c.id, "nopan"),
            ...measured(c.id),
            data: { query: q.id, clause: c, fault: faults[c.id], dialect },
          });
          return;
        }
        const movable = REPEATS.has(c.kind);
        out.push({
          id: c.id,
          type: "clause",
          position:
            drag?.what === "join" && drag.id === c.id ? drag.at : at.at[c.id],
          selected: c.id === selectedId,
          draggable: movable,
          // React Flow marks only draggable nodes nopan; without it the
          // pane swallows mousedown and the card's menus never open.
          className: look(q.id, c.id, movable ? undefined : "nopan"),
          dragHandle: ".clause-drag",
          ...measured(c.id),
          data: {
            clause: c,
            ordinal: i + 1,
            preview: previews[c.id],
            fault: faults[c.id],
            skipped: skipped.has(c.id),
            bind: binds.has(c.id),
            stale,
            cap,
            sampled: sampled && !stale,
            dialect,
            noPreview: write,
            removable: canRemove(l.clauses, c),
            outerRow,
            movable,
          },
        });
        (c.chains ?? []).forEach((ch) => {
          const head = chainHeadId(ch.id);
          out.push({
            id: head,
            type: "chain",
            position: at.at[head],
            selectable: false,
            draggable: false,
            className: look(q.id, null, "nopan"),
            ...measured(head),
            data: {
              chain: ch.id,
              title: chainTitle(c, i + 1),
              summary: chainSummary(ch, dialect),
              collapsed: ch.collapsed,
              outerRow: outer.has(ch.id),
              stale,
            },
          });
        });
      });
      if (hasAdd(l.id))
        out.push({
          id: addId(l.id),
          type: "add",
          position: at.at[addId(l.id)],
          selectable: false,
          draggable: false,
          className: look(q.id, null),
          ...measured(addId(l.id)),
          data: { index: l.clauses.length, chain: l.id },
        });
    }
    if (shown.length > 0)
      out.push({
        id: ADD_QUERY,
        type: "add-query",
        position: at.addQuery,
        selectable: false,
        draggable: false,
        ...measured(ADD_QUERY),
        data: {},
      });
    return out;
  }, [
    shown,
    heights,
    sizes,
    drag,
    picked,
    currentId,
    broken,
    outer,
    selectedId,
    previews,
    faults,
    skipped,
    binds,
    cap,
    sampled,
    dialect,
    hasAdd,
    search,
  ]);
  usePanTo(search?.focus ?? null, search?.nonce ?? 0, nodes);

  const edges = useMemo<FlowEdge[]>(() => {
    const out: FlowEdge[] = [];
    for (const l of listsOf(queries)) {
      const ids = l.clauses.map((c) => c.id);
      const n = ids.length;
      if (hasAdd(l.id)) ids.push(addId(l.id));
      if (l.head) ids.unshift(l.head);
      const shift = l.head ? 1 : 0;
      for (let k = 0; k + 1 < ids.length; k++) {
        const index = k + 1 - shift;
        const plus =
          !drag &&
          index > 0 &&
          index < n &&
          slotKinds(l.clauses, index, dialect, l.role).length > 0;
        out.push({
          id: `${ids[k]}->${ids[k + 1]}`,
          type: "insert",
          source: ids[k],
          target: ids[k + 1],
          selectable: false,
          focusable: false,
          ...(plus ? { data: { index, chain: l.id } } : {}),
        });
      }
      for (const c of l.clauses)
        for (const ch of c.chains ?? [])
          out.push({
            id: `side:${ch.id}`,
            type: "chain",
            source: c.id,
            sourceHandle: "side",
            target: chainHeadId(ch.id),
            selectable: false,
            focusable: false,
          });
    }
    return out;
  }, [queries, drag, dialect, hasAdd]);

  const addMenu = useMemo<AddMenu>(
    () => ({
      noun: "clause",
      render: (place, trigger, end) => {
        const id = place.chain as string;
        const q = queries.find((x) => x.id === id);
        const chain = q
          ? null
          : findChain(
              queries.flatMap((x) => x.clauses),
              id,
            );
        const parent =
          chain &&
          parentOf(
            queries.flatMap((x) => x.clauses),
            chain.id,
          );
        const clauses = q?.clauses ?? chain?.clauses;
        if (!clauses) return null;
        const role: ListRole = q ? "query" : roleOf(parent?.kind ?? "where");
        return (
          <AddClauseMenu
            kinds={
              end
                ? endKinds(clauses, dialect, role)
                : slotKinds(clauses, place.index, dialect, role)
            }
            trigger={trigger}
            onPick={(kind) =>
              actions.insert(
                id,
                end ? slotFor(clauses, kind) : place.index,
                kind,
              )
            }
          />
        );
      },
    }),
    [queries, actions, dialect],
  );

  /** The slot card `id` of `query` dragged to `at` takes among the cards
   *  of its kind in its list. */
  const joinSlot = (q: BuilderQuery, id: string, at: XY) => {
    const list = listOf(q.clauses, id) ?? [];
    const kind = list.find((c) => c.id === id)?.kind;
    const same = list
      .filter((c) => c.kind === kind && c.id !== id)
      .map((c) => c.id);
    return dragSlot(same, settled.at, heights, at.y, heights[id] ?? 0);
  };
  const dragOf = (n: FlowNode): Drag | null => {
    if (n.type === "query") {
      const id = n.data.query;
      return {
        what: "query",
        id,
        at: n.position,
        slot: laneSlot(
          settled.xs.filter((_, i) => queries[i]?.id !== id),
          n.position.x,
        ),
      };
    }
    if (n.type !== "clause") return null;
    const q = queryOf(queries, n.id);
    if (!q) return null;
    return {
      what: "join",
      query: q.id,
      id: n.id,
      at: n.position,
      slot: joinSlot(q, n.id, n.position),
    };
  };

  const all_cards = listsOf(queries).flatMap((l) => l.clauses);
  useFitOnce(all_cards.length > 0 && all_cards.every((c) => sizes[c.id]));

  return (
    <QueryActionsContext.Provider value={queryActions}>
      <ClauseActionsContext.Provider value={actions}>
        <AddMenuContext.Provider value={addMenu}>
          <ColumnsContext.Provider value={columns}>
            <TablesContext.Provider value={tables}>
              <div className="relative h-full w-full">
                <BuilderFlow<FlowNode, FlowEdge>
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  onNodesChange={onNodesChange}
                  onNodeClick={(n) => {
                    if (n.type === "clause" || n.type === "statement")
                      actions.select(n.id);
                  }}
                  onNodeDrag={(_, n) => setDrag(dragOf(n))}
                  onNodeDragStop={(_, n) => {
                    const d = dragOf(n);
                    setDrag(null);
                    if (d?.what === "query") queryActions.move(d.id, d.slot);
                    if (d?.what === "join") actions.moveJoin(d.id, d.slot);
                  }}
                  label="Query builder"
                  empty={queries.length === 0}
                  toolbar={toolbar}
                  history={history}
                />
                {queries.length === 0 && (
                  <DiagramEmpty
                    title="Build a query"
                    icon={<Blocks className="text-muted-foreground size-6" />}
                    description="Start from a table, then add joins, filters and groups. Every card shows the rows after it, run on the first rows of the table."
                  >
                    <AddQueryMenu
                      onPick={queryActions.add}
                      trigger={
                        <Button variant="outline" size="sm">
                          <Plus className="size-3.5" />
                          Query
                        </Button>
                      }
                    />
                  </DiagramEmpty>
                )}
              </div>
            </TablesContext.Provider>
          </ColumnsContext.Provider>
        </AddMenuContext.Provider>
      </ClauseActionsContext.Provider>
    </QueryActionsContext.Provider>
  );
}
