import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import {
  listSchemasIn,
  type ConnectionInfo,
  type DbKind,
  type SchemaGraph,
} from "@/shared/api";
import {
  actFromDiagram,
  CanvasButton,
  DiagramEmpty,
  RelationCanvas,
  exportBase,
  findTable,
  InferredToggle,
  NotationToggle,
  openFromDiagram,
  RefreshButton,
  TableSearch,
  tableId,
  type CanvasState,
  type Notation,
} from "@/shared/components/relation-canvas";
import {
  graphKey,
  useRelationGraphs,
  useStudioStore,
  type GraphEntry,
  type StudioTab,
} from "@/shared/store";
import { useSavedLayout } from "../lib/saved-layouts";
import { DatabasePicker } from "./database-picker";
import { FocusControls, type FocusState } from "./focus-controls";
import { SchemaSwitcher } from "./schema-switcher";

type RelationTab = Extract<StudioTab, { kind: "relation-diagram" }>;

/** Past this many tables a diagram opens in focus mode with a picker. */
export const FOCUS_THRESHOLD = 150;

const EMPTY_GRAPH: SchemaGraph = { tables: [], links: [] };
/** About how wide each toolbar's left side is (pickers, Focus, the toggle). */
const START_PX = { pickers: 420, picker: 300 };

const menuFlags = (conn: ConnectionInfo) => ({
  mongo: conn.kind === "mongodb",
  pg: conn.kind === "postgres",
  readOnly: !!conn.read_only,
});

const hasGraph = (entry: GraphEntry | undefined) =>
  entry?.status === "ready" || entry?.status === "partial";

/** A whole schema's relation diagram, one tab per database and schema. */
export function RelationDiagramTab({
  conn_id,
  tab_key,
  tab,
}: {
  conn_id: string;
  tab_key: string;
  tab: RelationTab;
}) {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  if (!conn) return null;
  if (conn.kind === "mongodb")
    return <MongoDiagram conn={conn} tab={tab} tab_key={tab_key} />;
  return <SqlDiagram conn={conn} tab={tab} tab_key={tab_key} />;
}

function MongoDiagram({
  conn,
  tab,
  tab_key,
}: {
  conn: ConnectionInfo;
  tab: RelationTab;
  tab_key: string;
}) {
  const conn_id = conn.id;
  const database = tab.database ?? conn.name;
  const entry = useRelationGraphs((s) => s.graphs[graphKey(conn_id, database)]);
  const load = useRelationGraphs((s) => s.loadMongoGraph);
  // const cancel = useRelationGraphs((s) => s.cancelMongoGraph);
  useEffect(() => {
    load(conn_id, database);
  }, [load, conn_id, database]);
  const setTarget = useStudioStore((s) => s.setRelationDiagramTarget);

  return (
    <DiagramBody
      conn={conn}
      tab_key={tab_key}
      entry={entry}
      database={database}
      emptyTitle={`No collections in ${database}`}
      loadingLabel="Listing collections…"
      onRefresh={() => load(conn_id, database, true)}
      streaming
      kind={"mongodb"}
      start={
        <DatabasePicker
          conn_id={conn_id}
          database={database}
          onChange={(d) => setTarget(conn_id, tab.id, { database: d })}
        />
      }
    />
  );
}

/** The schema to land on in another database: the current one if it has
 *  it, else `public`, else the first by name. */
export function schemaIn(schemas: string[], current?: string): string {
  if (current && schemas.includes(current)) return current;
  if (schemas.includes("public")) return "public";
  return [...schemas].sort()[0];
}

function SqlDiagram({
  conn,
  tab,
  tab_key,
}: {
  conn: ConnectionInfo;
  tab: RelationTab;
  tab_key: string;
}) {
  const { database, schema } = tab;
  const conn_id = conn.id;
  const entry = useRelationGraphs(
    (s) => s.graphs[graphKey(conn_id, database, schema)],
  );
  const load = useRelationGraphs((s) => s.loadSqlGraph);
  useEffect(() => {
    load(conn_id, database, schema);
  }, [load, conn_id, database, schema]);
  const setTarget = useStudioStore((s) => s.setRelationDiagramTarget);
  const push = useStudioStore((s) => s.pushNotification);

  // Only the latest pick may switch the tab, however the lookups finish.
  const pickSeq = useRef(0);
  // The database being switched to while its schemas are listed.
  const [pendingDb, setPendingDb] = useState<string | null>(null);
  const pickDatabase = (picked: string) => {
    const seq = ++pickSeq.current;
    setPendingDb(picked);
    listSchemasIn(conn_id, picked === conn.name ? undefined : picked)
      .then((schemas) => {
        if (seq !== pickSeq.current) return;
        if (schemas.length === 0) throw new Error("it has no schemas");
        setPendingDb(null);
        setTarget(conn_id, tab.id, {
          database: picked,
          schema: schemaIn(schemas, schema),
        });
      })
      .catch((e: unknown) => {
        if (seq !== pickSeq.current) return;
        setPendingDb(null);
        push({
          kind: "error",
          title: `Couldn't open ${picked}`,
          detail: e instanceof Error ? e.message : String(e),
        });
      });
  };

  return (
    <DiagramBody
      conn={conn}
      tab_key={tab_key}
      entry={pendingDb ? undefined : entry}
      database={database}
      schema={schema}
      emptyTitle={`No tables in ${schema ?? conn.name}`}
      onRefresh={() => load(conn_id, database, schema, true)}
      startPx={
        conn.kind === "postgres" && schema ? START_PX.pickers : START_PX.picker
      }
      start={
        conn.kind === "postgres" && schema ? (
          <>
            <DatabasePicker
              conn_id={conn_id}
              database={pendingDb ?? database ?? conn.name}
              onChange={pickDatabase}
            />
            <span>{"→"}</span>
            <SchemaSwitcher
              conn_id={conn_id}
              database={database}
              schema={schema}
              loading={!!pendingDb || entry?.status === "loading"}
              disabled={!!pendingDb}
              onChange={(s) =>
                setTarget(conn_id, tab.id, { database, schema: s })
              }
            />
          </>
        ) : null
      }
    />
  );
}

/** A schema diagram with its states drawn on the canvas, plus the controls
 *  every one shares: focus mode, Reset layout and Refresh. */
export function DiagramBody({
  conn,
  tab_key,
  entry,
  database,
  schema,
  emptyTitle,
  loadingLabel,
  onRefresh,
  start,
  startPx = START_PX.picker,
  end,
  kind,
  streaming = false,
}: {
  conn: ConnectionInfo;
  tab_key: string;
  entry: GraphEntry | undefined;
  database?: string;
  schema?: string;
  emptyTitle: string;
  loadingLabel?: string;
  onRefresh: () => void;
  start?: ReactNode;
  startPx?: number;
  end?: ReactNode;
  /** Draw what has arrived while the rest is still loading (Mongo). */
  streaming?: boolean;
  kind?: DbKind;
}) {
  const loading = !entry || entry.status === "loading";
  const growing = loading || entry?.status === "partial";
  const ready = hasGraph(entry);
  // A one shot load draws nothing until it lands.
  const g = (loading && !streaming ? null : entry?.graph) ?? EMPTY_GRAPH;
  const layout = useSavedLayout(conn.id, database, schema);

  const realCount = useMemo(() => g.tables.filter((t) => !t.stub).length, [g]);
  const big = realCount > FOCUS_THRESHOLD;
  const [userFocus, setUserFocus] = useState<FocusState | null | undefined>(
    undefined,
  );
  const focus: FocusState | null =
    userFocus === undefined
      ? big
        ? { table: null, hops: 1 }
        : null
      : userFocus;

  // "Open full diagram" from a table tab: center on it and select it.
  const request = useRelationGraphs((s) => s.focus[tab_key]);
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(
    null,
  );
  // Adjusted during render, React's pattern for state derived from a prop.
  const [handled, setHandled] = useState<number | null>(null);
  if (request && g.tables.length > 0 && handled !== request.nonce) {
    const t = findTable(g, request.table, request.schema);
    if (t) {
      const id = tableId(t);
      setHandled(request.nonce);
      if (focus) setUserFocus({ ...focus, table: id });
      setReveal({ id, nonce: request.nonce });
    }
  }

  const push = useStudioStore((s) => s.pushNotification);
  // Starts on Relation every mount and is never remembered.
  const [notation, setNotation] = useState<Notation>("relation");
  const er = notation === "er";

  const [hideInferred, setHideInferred] = useState(false);

  const state: CanvasState | null =
    entry?.status === "error"
      ? { kind: "error", message: entry.error, onRetry: onRefresh }
      : loading && g.tables.length === 0
        ? { kind: "loading", label: loadingLabel }
        : !growing && g.tables.length === 0
          ? { kind: "empty", title: emptyTitle }
          : null;
  const picking = !!focus && !focus.table && g.tables.length > 0;

  const focusName = focus?.table
    ? (g.tables.find((t) => tableId(t) === focus.table)?.name ?? null)
    : null;

  return (
    <RelationCanvas
      graph={picking ? EMPTY_GRAPH : g}
      focus={focus?.table ? { table: focus.table, hops: focus.hops } : null}
      saved={layout.saved}
      onSave={layout.save}
      onOpen={(t, view) => openFromDiagram(conn, t, view, database)}
      menu={menuFlags(conn)}
      onTableAction={(t, action) =>
        actFromDiagram(conn, t, action, database, g)
      }
      reveal={reveal}
      hideInferred={hideInferred}
      notation={notation}
      exportName={exportBase(conn, database, schema)}
      state={state}
      overlay={
        picking ? (
          <DiagramEmpty
            title="Pick a table to start from"
            description={
              big
                ? `This schema has ${realCount} tables, too many to draw at once. Pick one to see it with its neighbors.`
                : "Pick a table to see it with its neighbors."
            }
          >
            <TableSearch
              graph={g}
              onPick={(t) => {
                setUserFocus({ table: tableId(t), hops: focus.hops });
                setReveal(null);
              }}
              className="w-64"
            />
          </DiagramEmpty>
        ) : null
      }
      toolbar={
        <>
          {start}
          <FocusControls
            graph={g}
            focus={focus}
            focusName={focusName}
            disabled={!ready}
            onChange={(f) => {
              setUserFocus(f);
              setReveal(null);
            }}
          />
          <NotationToggle
            value={notation}
            onChange={setNotation}
            disabled={!ready}
          />
        </>
      }
      toolbarStartPx={startPx}
      controlsEnd={
        kind === "mongodb" ? (
          <InferredToggle
            hidden={hideInferred}
            onChange={setHideInferred}
            disabled={!hasGraph(entry)}
          />
        ) : undefined
      }
      toolbarEnd={
        <>
          {end}
          <CanvasButton
            disabled={!ready || !layout.saved || !!focus || er}
            onClick={layout.reset}
            title={
              er
                ? "ER view is laid out fresh each time"
                : "Forget dragged positions and lay the diagram out again"
            }
            label="Reset layout"
            shrink={0}
            icon={<LayoutGrid className="size-3.5" />}
          />
          <RefreshButton loading={growing} onClick={onRefresh} />
        </>
      }
      growing={growing}
      onNotice={(kind, title, detail) => push({ kind, title, detail })}
    />
  );
}
