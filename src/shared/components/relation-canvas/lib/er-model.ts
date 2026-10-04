import type {
  GraphColumn,
  GraphLink,
  GraphTable,
  SchemaGraph,
} from "@/shared/api/types";
import {
  endpointResolver,
  tableId,
  visibleColumns,
  type ColumnMode,
} from "./graph";
import {
  DIAMOND_HEIGHT,
  clusterGeometry,
  diamondWidth,
  type ClusterGeometry,
} from "./er-geometry";
import type { LayoutRequest } from "./elk-graph";

/** Crow's foot marks: exactly one, zero or one, zero or many. */
export type EndMark = "one" | "zero-one" | "many";

export interface ErEntity {
  id: string;
  table: GraphTable;
  /** The ovals the column toggle picks. */
  columns: GraphColumn[];
  geometry: ClusterGeometry;
}

export interface ErDiamond {
  id: string;
  label: string;
  title: string;
  width: number;
  height: number;
  inferred: boolean;
  /** The table a double click opens. */
  opens: GraphTable;
}

/** One line from a diamond to an entity, marked at the entity end. */
export interface ErLine {
  id: string;
  diamond: string;
  entity: string;
  end: "from" | "to";
  mark: EndMark;
  inferred: boolean;
}

export interface ErModel {
  entities: ErEntity[];
  diamonds: ErDiamond[];
  lines: ErLine[];
  /** Folded join table id → its diamond id. */
  folded: Map<string, string>;
}

/** The marks at each end of a link. The referenced end is exactly one when
 *  every FK column is NOT NULL; the referencing end is zero or one when the
 *  FK columns are unique; an array field is many to many. */
export function endMarks(
  link: GraphLink,
  from: GraphTable,
): { from: EndMark; to: EndMark } {
  if (link.array) return { from: "many", to: "many" };
  const byName = new Map(from.columns.map((c) => [c.name, c]));
  const required =
    link.from_columns.length > 0 &&
    link.from_columns.every((c) => byName.get(c)?.not_null);
  return {
    from: link.unique ? "zero-one" : "many",
    to: required ? "one" : "zero-one",
  };
}

function linkTitle(l: GraphLink): string {
  const del = l.on_delete ? `, ON DELETE ${l.on_delete}` : "";
  return `${l.id}${del}${l.inferred ? ", inferred" : ""}`;
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Tables drawn as one many to many diamond, with their two target table ids:
 *  exactly two outgoing links, neither inferred, both targets drawn, nothing
 *  pointing at it, and columns = the links' FK columns = its primary key. */
export function joinTables(
  graph: SchemaGraph,
  keep: ReadonlySet<string>,
): Map<string, [string, string]> {
  const resolve = endpointResolver(graph);
  const outgoing = new Map<string, { link: GraphLink; to?: string }[]>();
  const pointedAt = new Set<string>();
  for (const l of graph.links) {
    const { from, to } = resolve(l);
    if (to) pointedAt.add(to);
    if (from)
      outgoing.set(from, [...(outgoing.get(from) ?? []), { link: l, to }]);
  }
  const out = new Map<string, [string, string]>();
  for (const t of graph.tables) {
    const id = tableId(t);
    const own = outgoing.get(id) ?? [];
    if (t.stub || keep.has(id) || pointedAt.has(id) || own.length !== 2)
      continue;
    const [a, b] = own;
    if (!a.to || !b.to || a.link.inferred || b.link.inferred) continue;
    const keys = new Set([...a.link.from_columns, ...b.link.from_columns]);
    const columns = new Set(t.columns.map((c) => c.name));
    const pk = new Set(
      t.columns.filter((c) => c.primary_key).map((c) => c.name),
    );
    if (sameSet(keys, columns) && sameSet(keys, pk)) out.set(id, [a.to, b.to]);
  }
  return out;
}

export function buildErModel(
  graph: SchemaGraph,
  mode: ColumnMode,
  fks: Map<string, Set<string>>,
  keep: ReadonlySet<string> = new Set(),
): ErModel {
  const byId = new Map(graph.tables.map((t) => [tableId(t), t]));
  const joins = joinTables(graph, keep);
  const entities = graph.tables
    .filter((t) => !joins.has(tableId(t)))
    .map((t) => {
      const id = tableId(t);
      const columns = t.error ? [] : visibleColumns(t, mode, fks.get(id));
      return { id, table: t, columns, geometry: clusterGeometry(columns) };
    });
  const resolve = endpointResolver(graph);
  const diamonds: ErDiamond[] = [];
  const lines: ErLine[] = [];
  const folded = new Map<string, string>();
  for (const [tid, [a, b]] of joins) {
    const t = byId.get(tid)!;
    const id = `j:${tid}`;
    folded.set(tid, id);
    diamonds.push({
      id,
      label: t.name,
      title: `${tid}, join table`,
      width: diamondWidth(t.name),
      height: DIAMOND_HEIGHT,
      inferred: false,
      opens: t,
    });
    const line = (end: "from" | "to", entity: string): ErLine => ({
      id: `${id}:${end}`,
      diamond: id,
      entity,
      end,
      mark: "many",
      inferred: false,
    });
    lines.push(line("from", a), line("to", b));
  }
  for (const l of graph.links) {
    const { from, to } = resolve(l);
    const fromTable = from ? byId.get(from) : undefined;
    if (!from || !to || !fromTable || joins.has(from)) continue;
    const id = `d:${l.id}`;
    const label = l.from_columns.join(", ");
    diamonds.push({
      id,
      label,
      title: linkTitle(l),
      width: diamondWidth(label),
      height: DIAMOND_HEIGHT,
      inferred: l.inferred,
      opens: fromTable,
    });
    const marks = endMarks(l, fromTable);
    const line = (end: "from" | "to", entity: string): ErLine => ({
      id: `${id}:${end}`,
      diamond: id,
      entity,
      end,
      mark: marks[end],
      inferred: l.inferred,
    });
    lines.push(line("from", from), line("to", to));
  }
  return { entities, diamonds, lines, folded };
}

/** Entity clusters and diamonds as port free boxes, with edges running
 *  referencing entity → diamond → referenced entity, so layers read left to
 *  right like Relation view. */
export function erLayoutRequest(model: ErModel): LayoutRequest {
  return {
    nodes: [
      ...model.entities.map((e) => ({
        id: e.id,
        width: e.geometry.width,
        height: e.geometry.height,
        ports: null,
      })),
      ...model.diamonds.map((d) => ({
        id: d.id,
        width: d.width,
        height: d.height,
        ports: null,
      })),
    ],
    edges: model.lines.map((l) =>
      l.end === "from"
        ? {
            id: l.id,
            source: l.entity,
            sourcePort: null,
            target: l.diamond,
            targetPort: null,
          }
        : {
            id: l.id,
            source: l.diamond,
            sourcePort: null,
            target: l.entity,
            targetPort: null,
          },
    ),
  };
}

/** An entity's neighbors are its diamonds plus the entities across them; a
 *  diamond's are its one or two entities. */
export function erAdjacency(model: ErModel): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = adj.get(a) ?? new Set<string>();
    set.add(b);
    adj.set(a, set);
  };
  for (const e of model.entities) adj.set(e.id, new Set());
  const ends = new Map<string, string[]>();
  for (const l of model.lines) {
    add(l.diamond, l.entity);
    add(l.entity, l.diamond);
    ends.set(l.diamond, [...(ends.get(l.diamond) ?? []), l.entity]);
  }
  for (const [, [a, b]] of ends) {
    if (!b || a === b) continue;
    add(a, b);
    add(b, a);
  }
  return adj;
}
