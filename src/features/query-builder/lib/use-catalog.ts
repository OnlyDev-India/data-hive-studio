import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listSchemaObjects,
  listSchemasIn,
  listTables,
  schemaGraph,
  tableSchema,
  type GraphLink,
  type SchemaGraph,
} from "@/shared/api";
import type { Clause } from "@/shared/store";
import { queryTables } from "./compose";
import type { ColumnsOf } from "./columns";
import { unquote, type Dialect, type TableRef } from "./sql-text";

/** A table a picker offers, by the schema it sits in (null on SQLite). */
export interface PickTable {
  schema: string | null;
  name: string;
}

export interface Catalog {
  /** The tab's schema's tables and views first, then every other loaded
   *  schema's. */
  tables: PickTable[];
  /** Every schema of the database (Postgres). */
  schemas: string[];
  /** Load the other schemas' tables, for a picker that was opened. */
  loadOtherSchemas: () => void;
  columnsOf: ColumnsOf;
  /** Foreign keys of every schema the query reads. */
  links: GraphLink[];
}

interface Loaded {
  graphs: Record<string, SchemaGraph>;
  tables: Record<string, PickTable[]>;
  schemas: string[];
  extra: Record<string, { name: string; type: string }[]>;
}

const NOTHING: Loaded = { graphs: {}, tables: {}, schemas: [], extra: {} };

/** Whether identifier `ident` (as written) names catalog name `name`. Bare
 *  names fold to lower case on Postgres; SQLite ignores case. */
export function sameName(ident: string, name: string, dialect: Dialect) {
  const quoted = /^["`[]/.test(ident);
  const bare = unquote(ident);
  if (quoted) return bare === name;
  return dialect === "postgresql"
    ? bare.toLowerCase() === name
    : bare.toLowerCase() === name.toLowerCase();
}

/** The tab's catalog: what the table pickers list, each query table's
 *  typed columns, and the foreign keys between them. Fetched once per
 *  database and schema, while connected. */
export function useCatalog({
  conn_id,
  connected,
  dialect,
  database,
  schema,
  clauses,
}: {
  conn_id: string;
  connected: boolean;
  dialect: Dialect;
  database: string | null;
  schema: string | null;
  clauses: Clause[];
}): Catalog {
  const db = database ?? undefined;
  const home = schema ?? "";
  const [state, setState] = useState<Loaded & { key: string }>({
    key: "",
    ...NOTHING,
  });
  const key = `${db ?? ""}\n${home}`;
  // A new database or schema starts from nothing.
  const cur: Loaded = state.key === key ? state : NOTHING;

  const put = useCallback(
    (fn: (s: Loaded) => Partial<Loaded>) =>
      setState((s) => {
        const base = s.key === key ? s : { key, ...NOTHING };
        return { ...base, ...fn(base) };
      }),
    [key],
  );

  const loadTables = useCallback(
    async (s: string) => {
      if (dialect === "sqlite") {
        const list = await listTables(conn_id);
        return list.map((t) => ({ schema: null, name: t.name }));
      }
      const [tables, views] = await Promise.all([
        listSchemaObjects(conn_id, s, "table", db),
        listSchemaObjects(conn_id, s, "view", db).catch(() => []),
      ]);
      return [...tables, ...views].map((t) => ({ schema: s, name: t.name }));
    },
    [conn_id, dialect, db],
  );

  // The tab's own schema: its tables, and the list of schemas.
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void loadTables(home)
      .then((t) => {
        if (live) put((s) => ({ tables: { ...s.tables, [home]: t } }));
      })
      .catch(() => {});
    if (dialect === "postgresql")
      void listSchemasIn(conn_id, db)
        .then((schemas) => {
          if (live) put(() => ({ schemas }));
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [connected, conn_id, dialect, db, home, loadTables, put]);

  // A graph per schema the query reads, the tab's own always.
  const refs = queryTables(clauses);
  const schemaOf = useCallback(
    (t: TableRef) =>
      dialect === "sqlite" ? "" : t.schema ? unquote(t.schema) : home,
    [dialect, home],
  );
  const wanted = [...new Set([home, ...refs.map(schemaOf)])].sort().join("\n");
  const graphs = cur.graphs;
  useEffect(() => {
    if (!connected) return;
    let live = true;
    // Calls already in flight are shared by `schemaGraph` itself.
    for (const s of wanted.split("\n")) {
      if (graphs[s]) continue;
      void schemaGraph(conn_id, db, s || undefined)
        .then((r) => {
          if (live) put((x) => ({ graphs: { ...x.graphs, [s]: r.graph } }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [connected, conn_id, db, wanted, graphs, put]);

  const fromGraph = useCallback(
    (t: TableRef) => {
      const g = graphs[schemaOf(t)];
      const found = g?.tables.find(
        (x) => !x.stub && sameName(t.name, x.name, dialect),
      );
      return found?.columns.map((c) => ({ name: c.name, type: c.data_type }));
    },
    [graphs, dialect, schemaOf],
  );

  const extra = cur.extra;
  // A view (or anything the graph leaves out) asks for its own columns.
  const missing = refs
    .filter((t) => {
      const s = schemaOf(t);
      return graphs[s] && !fromGraph(t) && !extra[`${s}.${unquote(t.name)}`];
    })
    .map((t) => `${schemaOf(t)}.${unquote(t.name)}`);
  const missing_key = [...new Set(missing)].sort().join("\n");
  useEffect(() => {
    if (!connected || !missing_key) return;
    let live = true;
    for (const k of missing_key.split("\n")) {
      const dot = k.indexOf(".");
      const s = k.slice(0, dot);
      const name = k.slice(dot + 1);
      void tableSchema(conn_id, name, db, s || undefined)
        .then((t) => {
          if (!live) return;
          const cols = t.columns.map((c) => ({
            name: c.name,
            type: c.data_type,
          }));
          put((x) => ({ extra: { ...x.extra, [k]: cols } }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [connected, conn_id, db, missing_key, put]);

  const columnsOf: ColumnsOf = useCallback(
    (t) => fromGraph(t) ?? extra[`${schemaOf(t)}.${unquote(t.name)}`],
    [fromGraph, extra, schemaOf],
  );

  const loadOtherSchemas = useCallback(() => {
    if (!connected || dialect !== "postgresql") return;
    for (const s of cur.schemas) {
      if (s === home || cur.tables[s]) continue;
      void loadTables(s)
        .then((t) => put((x) => ({ tables: { ...x.tables, [s]: t } })))
        .catch(() => {});
    }
  }, [connected, dialect, cur.schemas, cur.tables, home, loadTables, put]);

  const tables = useMemo(() => {
    const own = cur.tables[home] ?? [];
    const others = Object.entries(cur.tables)
      .filter(([s]) => s !== home)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([, t]) => t);
    return [...own, ...others];
  }, [cur.tables, home]);

  const links = useMemo(
    () => Object.values(graphs).flatMap((g) => g.links),
    [graphs],
  );

  return {
    tables,
    schemas: cur.schemas,
    loadOtherSchemas,
    columnsOf,
    links,
  };
}
