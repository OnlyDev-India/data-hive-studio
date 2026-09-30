import type { GraphLink, GraphTable, SchemaGraph } from "@/shared/api/types";

/** Which columns boxes list: every column, key columns only, or none. */
export type ColumnMode = "all" | "keys" | "names";

export type { XY } from "@/shared/store/types";

/** `schema.name` for real tables, `~schema.name` for stubs; SQLite and Mongo
 *  have no schema, so just the name. Also the saved layout's key. */
export function tableId(
  t: Pick<GraphTable, "schema" | "name" | "stub">,
): string {
  const base = t.schema ? `${t.schema}.${t.name}` : t.name;
  return t.stub ? `~${base}` : base;
}

/** Resolves a link's two ends to table ids. */
export function endpointResolver(graph: SchemaGraph) {
  const ids = new Map<string, string>();
  for (const t of graph.tables)
    ids.set(`${t.schema ?? ""}\u0000${t.name}`, tableId(t));
  const find = (schema: string | null, name: string) =>
    ids.get(`${schema ?? ""}\u0000${name}`);
  return (l: GraphLink) => ({
    from: find(l.from_schema, l.from_table),
    to: find(l.to_schema, l.to_table),
  });
}

/** Undirected neighbor lists, keyed by table id. */
export function adjacency(graph: SchemaGraph): Map<string, Set<string>> {
  const resolve = endpointResolver(graph);
  const adj = new Map<string, Set<string>>();
  for (const t of graph.tables) adj.set(tableId(t), new Set());
  for (const l of graph.links) {
    const { from, to } = resolve(l);
    if (!from || !to) continue;
    adj.get(from)?.add(to);
    adj.get(to)?.add(from);
  }
  return adj;
}

/** `center` plus every table within `hops` links of it, either direction. */
export function hopSet(
  adj: Map<string, Set<string>>,
  center: string,
  hops: number,
): Set<string> {
  const seen = new Set([center]);
  let frontier = [center];
  for (let i = 0; i < hops && frontier.length > 0; i++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const n of adj.get(id) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          next.push(n);
        }
    frontier = next;
  }
  return seen;
}

/** The graph cut down to `keep`, with only links whose both ends stay. */
export function subgraph(graph: SchemaGraph, keep: Set<string>): SchemaGraph {
  const resolve = endpointResolver(graph);
  return {
    tables: graph.tables.filter((t) => keep.has(tableId(t))),
    links: graph.links.filter((l) => {
      const { from, to } = resolve(l);
      return !!from && !!to && keep.has(from) && keep.has(to);
    }),
  };
}

/** Column names that take part in any outgoing link, per table id. */
export function fkColumns(graph: SchemaGraph): Map<string, Set<string>> {
  const resolve = endpointResolver(graph);
  const out = new Map<string, Set<string>>();
  for (const l of graph.links) {
    const { from } = resolve(l);
    if (!from) continue;
    const set = out.get(from) ?? new Set<string>();
    for (const c of l.from_columns) set.add(c);
    out.set(from, set);
  }
  return out;
}

/** Below this zoom boxes show names only, as a performance floor. */
export const ZOOM_FLOOR = 0.2;

/** The column toggle decides, except under the zoom floor. */
export function shownMode(mode: ColumnMode, belowFloor: boolean): ColumnMode {
  return belowFloor ? "names" : mode;
}

export const belowZoomFloor = (s: { transform: [number, number, number] }) =>
  s.transform[2] < ZOOM_FLOOR;

export function visibleColumns(
  table: GraphTable,
  mode: ColumnMode,
  fks: Set<string> | undefined,
): GraphTable["columns"] {
  if (table.stub || mode === "names") return [];
  if (mode === "all") return table.columns;
  return table.columns.filter((c) => c.primary_key || fks?.has(c.name));
}

/** Tables whose name contains `q`, exact and prefix matches first. */
export function searchTables(graph: SchemaGraph, q: string): GraphTable[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const score = (name: string) => {
    const n = name.toLowerCase();
    if (n === needle) return 0;
    if (n.startsWith(needle)) return 1;
    return n.includes(needle) ? 2 : -1;
  };
  return graph.tables
    .map((t) => ({ t, s: score(t.name) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.t.name.localeCompare(b.t.name))
    .map((x) => x.t);
}

/** The table with this name, preferring a real table over a stub and the
 *  given schema when there is one. */
export function findTable(
  graph: SchemaGraph,
  name: string,
  schema?: string | null,
): GraphTable | undefined {
  const named = graph.tables.filter((t) => t.name === name);
  return (
    named.find((t) => !t.stub && (schema == null || t.schema === schema)) ??
    named.find((t) => !t.stub) ??
    named[0]
  );
}
