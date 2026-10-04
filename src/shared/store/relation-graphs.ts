import { create } from "zustand";
import { schemaGraph } from "../api/connection";
import { mongoGraph } from "../api/relation-graph";
import { cancelRun } from "../api/query";
import type { GraphLink, GraphTable, SchemaGraph } from "../api/types";

export type GraphStatus = "loading" | "partial" | "ready" | "error";

export interface GraphTarget {
  connId: string;
  database?: string;
  schema?: string;
  mongo: boolean;
}

export interface GraphEntry {
  graph: SchemaGraph;
  /** What was loaded, so a catalog change can find the entries it touches. */
  target: GraphTarget;
  loaded_at: number;
  status: GraphStatus;
  /** Mongo: collections sampled so far, and how many there are. */
  sampled?: number;
  total?: number;
  error?: string;
}

/** Mongo diagrams leave `schema` out. */
export function graphKey(
  connId: string,
  database?: string,
  schema?: string,
): string {
  return `${connId}|${database ?? ""}|${schema ?? ""}`;
}

const EMPTY_GRAPH: SchemaGraph = { tables: [], links: [] };
/** How often a Mongo sample in progress is drawn again. */
const FLUSH_MS = 200;

interface RelationGraphState {
  /** Every loaded diagram graph for this app session. Never persisted. */
  graphs: Record<string, GraphEntry>;
  /** A table a diagram tab should center on and select, with a nonce so
   *  asking for the same table twice still moves the view. */
  focus: Record<string, { table: string; schema?: string; nonce: number }>;
  /** Load a SQL schema's graph unless it is cached. `force` refetches. */
  loadSqlGraph: (
    connId: string,
    database?: string,
    schema?: string,
    force?: boolean,
  ) => void;
  /** Sample a Mongo database unless it is cached or already sampling.
   *  `force` drops the cached sample and starts again. */
  loadMongoGraph: (connId: string, database: string, force?: boolean) => void;
  /** Stop a Mongo sample, keeping what has loaded. */
  cancelMongoGraph: (connId: string, database: string) => void;
  /** Reload, keeping saved positions, every graph of this connection that
   *  shows `rawDatabase` (undefined = any) and, on Postgres, `schema` or a
   *  stub of it (undefined = any). A target with no database is
   *  `ownDatabase`. */
  reloadMatching: (
    connId: string,
    rawDatabase: string | undefined,
    schema: string | undefined,
    ownDatabase: string,
  ) => void;
  setEntry: (key: string, entry: GraphEntry | null) => void;
  requestFocus: (tabKey: string, table: string, schema?: string) => void;
}

// The newest request per key; an older answer that lands late is dropped.
const latest = new Map<string, number>();
const mongoRuns = new Map<string, string>();
let seq = 0;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useRelationGraphs = create<RelationGraphState>()((set, get) => ({
  graphs: {},
  focus: {},
  loadSqlGraph(connId, database, schema, force = false) {
    const key = graphKey(connId, database, schema);
    const cur = get().graphs[key];
    if (!force && cur && cur.status !== "error") return;
    const target: GraphTarget = { connId, database, schema, mongo: false };
    const token = ++seq;
    latest.set(key, token);
    get().setEntry(key, {
      target,
      graph: EMPTY_GRAPH,
      loaded_at: Date.now(),
      status: "loading",
    });
    schemaGraph(connId, database, schema).then(
      (res) => {
        if (latest.get(key) !== token) return;
        get().setEntry(key, {
          target,
          graph: res.graph,
          loaded_at: Date.now(),
          status: "ready",
        });
      },
      (e: unknown) => {
        if (latest.get(key) !== token) return;
        get().setEntry(key, {
          target,
          graph: EMPTY_GRAPH,
          loaded_at: Date.now(),
          status: "error",
          error: message(e),
        });
      },
    );
  },
  loadMongoGraph(connId, database, force = false) {
    const key = graphKey(connId, database);
    const cur = get().graphs[key];
    if (!force && cur && cur.status !== "error") return;
    const old = mongoRuns.get(key);
    if (old) void cancelRun(connId, old).catch(() => {});
    const token = ++seq;
    const runId = crypto.randomUUID();
    const target: GraphTarget = { connId, database, mongo: true };
    latest.set(key, token);
    mongoRuns.set(key, runId);
    get().setEntry(key, {
      target,
      graph: EMPTY_GRAPH,
      loaded_at: Date.now(),
      status: "loading",
      sampled: 0,
    });

    const tables: GraphTable[] = [];
    const links: GraphLink[] = [];
    let total: number | undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (status: GraphStatus) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (latest.get(key) !== token) return;
      get().setEntry(key, {
        target,
        graph: { tables: [...tables], links: [...links] },
        loaded_at: Date.now(),
        status,
        sampled: tables.length,
        total,
      });
    };
    mongoGraph(
      connId,
      database,
      (event) => {
        if (event.kind === "start") {
          total = event.total;
          flush(event.total === 0 ? "ready" : "partial");
        } else if (event.kind === "collection") {
          tables.push(event.table);
          links.push(...event.links);
          timer ??= setTimeout(() => flush("partial"), FLUSH_MS);
        }
      },
      runId,
    ).then(
      () => {
        if (mongoRuns.get(key) === runId) mongoRuns.delete(key);
        flush("ready");
      },
      (e: unknown) => {
        if (mongoRuns.get(key) === runId) mongoRuns.delete(key);
        if (timer) clearTimeout(timer);
        if (latest.get(key) !== token) return;
        get().setEntry(key, {
          target,
          graph: { tables: [...tables], links: [...links] },
          loaded_at: Date.now(),
          status: "error",
          sampled: tables.length,
          total,
          error: message(e),
        });
      },
    );
  },
  cancelMongoGraph(connId, database) {
    const runId = mongoRuns.get(graphKey(connId, database));
    if (runId) void cancelRun(connId, runId).catch(() => {});
  },
  reloadMatching(connId, rawDatabase, schema, ownDatabase) {
    for (const { target: t, graph } of Object.values(get().graphs)) {
      if (t.connId !== connId) continue;
      if (
        rawDatabase !== undefined &&
        (t.database ?? ownDatabase) !== rawDatabase
      )
        continue;
      if (t.mongo) {
        get().loadMongoGraph(connId, t.database ?? ownDatabase, true);
        continue;
      }
      const touches =
        schema === undefined ||
        t.schema === schema ||
        graph.tables.some((x) => x.stub && x.schema === schema);
      if (touches) get().loadSqlGraph(connId, t.database, t.schema, true);
    }
  },
  setEntry(key, entry) {
    set((s) => {
      const graphs = { ...s.graphs };
      if (entry) graphs[key] = entry;
      else delete graphs[key];
      return { graphs };
    });
  },
  requestFocus(tabKey, table, schema) {
    set((s) => ({
      focus: { ...s.focus, [tabKey]: { table, schema, nonce: ++seq } },
    }));
  },
}));
