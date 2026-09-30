import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import {
  getActiveSchema,
  type ConnectionInfo,
  type GraphTable,
  type SchemaGraph,
} from "@/shared/api";
import {
  adjacency,
  CanvasButton,
  RelationCanvas,
  findTable,
  InferredToggle,
  openFromDiagram,
  RefreshButton,
  SampleProgress,
  tableId,
  type CanvasState,
} from "@/shared/components/relation-canvas";
import {
  graphKey,
  useRelationGraphs,
  useStudioStore,
  type GraphEntry,
} from "@/shared/store";

const EMPTY_GRAPH: SchemaGraph = { tables: [], links: [] };

/** A table tab's Diagram mode: this table, every table it references and
 *  every table that references it. Laid out fresh each time, never saved. */
export function TableDiagram({
  conn,
  table,
  database,
  schema,
}: {
  conn: ConnectionInfo;
  table: string;
  database?: string;
  schema?: string;
}) {
  const conn_id = conn.id;
  // A Postgres tab on the active schema needs its name for the graph and
  // for "Open full diagram".
  const [active, setActive] = useState<string | null>(null);
  const needsActive = conn.kind === "postgres" && !schema;
  useEffect(() => {
    if (!needsActive) return;
    let live = true;
    getActiveSchema(conn_id).then(
      (s) => live && setActive(s),
      () => live && setActive("public"),
    );
    return () => {
      live = false;
    };
  }, [needsActive, conn_id]);
  const target = needsActive ? (active ?? undefined) : schema;
  const ready = !needsActive || active !== null;

  const entry = useRelationGraphs((s) =>
    ready ? s.graphs[graphKey(conn_id, database, target)] : undefined,
  );
  const load = useRelationGraphs((s) => s.loadSqlGraph);
  useEffect(() => {
    if (ready) load(conn_id, database, target);
  }, [ready, load, conn_id, database, target]);

  return (
    <OneHop
      conn={conn}
      entry={entry}
      table={table}
      schema={target}
      database={database}
      onRefresh={() => load(conn_id, database, target, true)}
    />
  );
}

/** A collection tab's Diagram mode. Its outgoing links show once it is
 *  sampled; incoming ones come from the shared sample of the database. */
export function CollectionDiagram({
  conn,
  database,
  collection,
}: {
  conn: ConnectionInfo;
  database: string;
  collection: string;
}) {
  const conn_id = conn.id;
  const entry = useRelationGraphs((s) => s.graphs[graphKey(conn_id, database)]);
  const load = useRelationGraphs((s) => s.loadMongoGraph);
  const cancel = useRelationGraphs((s) => s.cancelMongoGraph);
  useEffect(() => {
    load(conn_id, database);
  }, [load, conn_id, database]);
  const [hideInferred, setHideInferred] = useState(false);

  return (
    <OneHop
      conn={conn}
      entry={entry}
      table={collection}
      database={database}
      onRefresh={() => load(conn_id, database, true)}
      hideInferred={hideInferred}
      waiting={`Sampling ${collection}…`}
      extra={
        <>
          <SampleProgress
            entry={entry}
            onCancel={() => cancel(conn_id, database)}
          />
          <InferredToggle
            hidden={hideInferred}
            onChange={setHideInferred}
            disabled={entry?.status !== "ready" && entry?.status !== "partial"}
          />
        </>
      }
    />
  );
}

/** Links touching `self` whose other end has not been sampled yet get a
 *  placeholder box, so they show before the rest of the sample lands. */
function withPlaceholders(graph: SchemaGraph, self: string): SchemaGraph {
  const have = new Set(graph.tables.map((t) => t.name));
  const extra: GraphTable[] = [];
  for (const l of graph.links) {
    if (l.from_table !== self && l.to_table !== self) continue;
    for (const name of [l.from_table, l.to_table])
      if (!have.has(name)) {
        have.add(name);
        extra.push({ schema: null, name, stub: true, columns: [] });
      }
  }
  return extra.length
    ? { ...graph, tables: [...graph.tables, ...extra] }
    : graph;
}

function OneHop({
  conn,
  entry,
  table,
  schema,
  database,
  onRefresh,
  hideInferred,
  waiting,
  extra,
}: {
  conn: ConnectionInfo;
  entry: GraphEntry | undefined;
  table: string;
  schema?: string;
  database?: string;
  onRefresh: () => void;
  hideInferred?: boolean;
  /** Mongo: what to say until this collection itself is sampled. */
  waiting?: string;
  extra?: ReactNode;
}) {
  const mongo = conn.kind === "mongodb";
  const growing =
    !entry || entry.status === "loading" || entry.status === "partial";
  const graph = useMemo(
    () =>
      entry && mongo ? withPlaceholders(entry.graph, table) : entry?.graph,
    [entry, mongo, table],
  );
  const self = useMemo(
    () => (graph ? findTable(graph, table, schema) : undefined),
    [graph, table, schema],
  );
  const selfId = self && !self.stub ? tableId(self) : null;
  const shown = useMemo(
    () =>
      graph && hideInferred
        ? { ...graph, links: graph.links.filter((l) => !l.inferred) }
        : graph,
    [graph, hideInferred],
  );
  const lonely = useMemo(
    () =>
      !!shown && !!selfId && (adjacency(shown).get(selfId)?.size ?? 0) === 0,
    [shown, selfId],
  );

  const openRelationDiagram = useStudioStore((s) => s.openRelationDiagram);
  const push = useStudioStore((s) => s.pushNotification);

  // Until this table is in the graph there is nothing to center on, so the
  // canvas draws nothing rather than the whole schema.
  const state: CanvasState | null =
    entry?.status === "error"
      ? { kind: "error", message: entry.error, onRetry: onRefresh }
      : !graph || (!selfId && growing)
        ? { kind: "loading", label: mongo ? waiting : undefined }
        : !selfId
          ? {
              kind: "error",
              message: `“${table}” isn't in the ${mongo ? "sample" : "catalog"} any more.`,
              onRetry: onRefresh,
            }
          : null;

  return (
    <RelationCanvas
      graph={graph && selfId ? graph : EMPTY_GRAPH}
      focus={selfId ? { table: selfId, hops: 1 } : null}
      state={state}
      hideInferred={hideInferred}
      growing={growing}
      onOpen={(t, view) => openFromDiagram(conn, t, view, database)}
      exportName={`${table}-diagram`}
      toolbar={
        lonely && !growing ? (
          <span role="status" className="text-muted-foreground text-small">
            {mongo
              ? "No links to or from this collection."
              : "No foreign keys to or from this table."}
          </span>
        ) : null
      }
      toolbarEnd={
        <>
          {extra}
          <CanvasButton
            variant="outline"
            onClick={() =>
              openRelationDiagram(conn.id, {
                database,
                schema,
                focusTable: table,
              })
            }
            title={`Open the whole ${mongo ? "database" : "schema"}'s diagram, centered on this ${mongo ? "collection" : "table"}`}
            label="Open full diagram"
            shrink={0}
            icon={<Maximize2 className="size-3.5" />}
          />
          <RefreshButton loading={growing} onClick={onRefresh} />
        </>
      }
      onNotice={(kind, title, detail) => push({ kind, title, detail })}
    />
  );
}
