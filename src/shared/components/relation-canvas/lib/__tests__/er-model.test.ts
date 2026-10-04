import { describe, expect, it } from "vitest";
import type {
  GraphColumn,
  GraphLink,
  GraphTable,
  SchemaGraph,
} from "@/shared/api/types";
import { fkColumns } from "../graph";
import {
  buildErModel,
  endMarks,
  erAdjacency,
  erLayoutRequest,
} from "../er-model";
import { clusterGeometry, ENTITY_HEIGHT, ovalWidth } from "../er-geometry";
import { toElkGraph } from "../elk-graph";

const col = (name: string, over: Partial<GraphColumn> = {}): GraphColumn => ({
  name,
  data_type: "integer",
  primary_key: false,
  not_null: false,
  ...over,
});

const table = (name: string, columns: GraphColumn[]): GraphTable => ({
  schema: null,
  name,
  stub: false,
  columns,
});

const link = (
  from: string,
  cols: string[],
  to: string,
  over: Partial<GraphLink> = {},
): GraphLink => ({
  id: `${from}#${cols.join("_")}`,
  from_schema: null,
  from_table: from,
  from_columns: cols,
  to_schema: null,
  to_table: to,
  to_columns: cols.map(() => "id"),
  inferred: false,
  ...over,
});

const users = table("users", [
  col("id", { primary_key: true, not_null: true }),
]);

describe("endMarks", () => {
  it("is exactly one at a NOT NULL reference and zero or many behind it", () => {
    const posts = table("posts", [col("author_id", { not_null: true })]);
    expect(endMarks(link("posts", ["author_id"], "users"), posts)).toEqual({
      from: "many",
      to: "one",
    });
  });

  it("is zero or one at a nullable reference", () => {
    const posts = table("posts", [col("author_id")]);
    expect(endMarks(link("posts", ["author_id"], "users"), posts).to).toBe(
      "zero-one",
    );
  });

  it("needs every column of a composite key to be NOT NULL", () => {
    const t = table("t", [col("a", { not_null: true }), col("b")]);
    expect(endMarks(link("t", ["a", "b"], "users"), t).to).toBe("zero-one");
  });

  it("is zero or one at the referencing end of a unique link", () => {
    const profiles = table("profiles", [col("user_id", { not_null: true })]);
    const l = link("profiles", ["user_id"], "users", { unique: true });
    expect(endMarks(l, profiles)).toEqual({ from: "zero-one", to: "one" });
  });

  it("treats a link from an older server as many to one", () => {
    const posts = table("posts", [col("author_id")]);
    const l = link("posts", ["author_id"], "users");
    delete l.unique;
    expect(endMarks(l, posts).from).toBe("many");
  });

  it("is many to many for an array field", () => {
    const posts = table("posts", [col("tagIds")]);
    const l = link("posts", ["tagIds"], "tags", {
      inferred: true,
      array: true,
    });
    expect(endMarks(l, posts)).toEqual({ from: "many", to: "many" });
  });
});

describe("buildErModel", () => {
  const posts = table("posts", [
    col("id", { primary_key: true, not_null: true }),
    col("author_id", { not_null: true }),
    col("body"),
  ]);
  const emp = table("emp", [col("id", { primary_key: true }), col("boss")]);
  const graph: SchemaGraph = {
    tables: [users, posts, emp],
    links: [
      link("posts", ["author_id"], "users"),
      link("posts", ["author_id"], "users", { id: "second" }),
      link("emp", ["boss"], "emp"),
    ],
  };
  const fks = fkColumns(graph);

  it("draws one diamond per link, labelled with its FK columns", () => {
    const m = buildErModel(graph, "all", fks);
    expect(m.diamonds.map((d) => d.id)).toEqual([
      "d:posts#author_id",
      "d:second",
      "d:emp#boss",
    ]);
    expect(m.diamonds[0].label).toBe("author_id");
    expect(m.diamonds[0].opens.name).toBe("posts");
  });

  it("gives each diamond a from and a to line, a self link both to one entity", () => {
    const m = buildErModel(graph, "all", fks);
    const self = m.lines.filter((l) => l.diamond === "d:emp#boss");
    expect(self.map((l) => [l.end, l.entity])).toEqual([
      ["from", "emp"],
      ["to", "emp"],
    ]);
    const first = m.lines.filter((l) => l.diamond === "d:posts#author_id");
    expect(first.map((l) => l.mark)).toEqual(["many", "one"]);
  });

  it("picks ovals with the column toggle", () => {
    const ovals = (mode: "all" | "keys" | "names") =>
      buildErModel(graph, mode, fks)
        .entities.find((e) => e.id === "posts")!
        .columns.map((c) => c.name);
    expect(ovals("all")).toEqual(["id", "author_id", "body"]);
    expect(ovals("keys")).toEqual(["id", "author_id"]);
    expect(ovals("names")).toEqual([]);
  });

  it("draws a stub and a failed collection without ovals", () => {
    const stub = { ...table("accounts", [col("id")]), schema: "b", stub: true };
    const failed = { ...table("logs", [col("x")]), error: "timed out" };
    const g: SchemaGraph = { tables: [stub, failed], links: [] };
    const m = buildErModel(g, "all", fkColumns(g));
    expect(m.entities.map((e) => e.columns.length)).toEqual([0, 0]);
  });

  it("lights an entity's diamonds and the entities across them", () => {
    const adj = erAdjacency(buildErModel(graph, "all", fks));
    expect([...adj.get("users")!].sort()).toEqual(
      ["d:posts#author_id", "d:second", "posts"].sort(),
    );
    expect([...adj.get("d:emp#boss")!]).toEqual(["emp"]);
  });
});

describe("the join table fold", () => {
  const pk = { primary_key: true, not_null: true };
  const roles = table("roles", [col("id", pk)]);
  const userRoles = (extra: GraphColumn[] = []) =>
    table("user_roles", [col("user_id", pk), col("role_id", pk), ...extra]);
  const junction = (extra: GraphColumn[] = []): SchemaGraph => ({
    tables: [users, roles, userRoles(extra)],
    links: [
      link("user_roles", ["user_id"], "users"),
      link("user_roles", ["role_id"], "roles"),
    ],
  });
  const model = (g: SchemaGraph, keep?: Set<string>) =>
    buildErModel(g, "all", fkColumns(g), keep);

  it("folds a two key junction into one diamond, many at both ends", () => {
    const m = model(junction());
    expect(m.entities.map((e) => e.id)).toEqual(["users", "roles"]);
    expect(m.diamonds.map((d) => [d.id, d.label, d.opens.name])).toEqual([
      ["j:user_roles", "user_roles", "user_roles"],
    ]);
    expect(m.lines.map((l) => [l.entity, l.mark])).toEqual([
      ["users", "many"],
      ["roles", "many"],
    ]);
    expect(m.folded.get("user_roles")).toBe("j:user_roles");
  });

  it("keeps a junction with an extra column as an entity with two diamonds", () => {
    const m = model(junction([col("granted_at")]));
    expect(m.entities.map((e) => e.id)).toContain("user_roles");
    expect(m.diamonds.map((d) => d.id)).toEqual([
      "d:user_roles#user_id",
      "d:user_roles#role_id",
    ]);
    expect(m.folded.size).toBe(0);
  });

  it("folds a self join into a diamond looping on one entity", () => {
    const follows = table("follows", [
      col("follower_id", pk),
      col("followee_id", pk),
    ]);
    const g: SchemaGraph = {
      tables: [users, follows],
      links: [
        link("follows", ["follower_id"], "users"),
        link("follows", ["followee_id"], "users"),
      ],
    };
    const m = model(g);
    expect(m.diamonds.map((d) => d.id)).toEqual(["j:follows"]);
    expect(m.lines.map((l) => l.entity)).toEqual(["users", "users"]);
    expect([...erAdjacency(m).get("j:follows")!]).toEqual(["users"]);
  });

  it("never folds a kept table, such as the focus table", () => {
    const m = model(junction(), new Set(["user_roles"]));
    expect(m.entities.map((e) => e.id)).toContain("user_roles");
    expect(m.folded.size).toBe(0);
  });

  it("keeps a junction whose second target is not drawn", () => {
    const g = junction();
    const cut: SchemaGraph = {
      tables: g.tables.filter((t) => t.name !== "roles"),
      links: g.links,
    };
    expect(model(cut).folded.size).toBe(0);
  });

  it("keeps a junction that something points to, or whose key is wider", () => {
    const g = junction();
    const pointed: SchemaGraph = {
      tables: [...g.tables, table("audit", [col("ur")])],
      links: [...g.links, link("audit", ["ur"], "user_roles")],
    };
    expect(model(pointed).folded.size).toBe(0);
    const surrogate = junction([col("id", pk)]);
    expect(model(surrogate).folded.size).toBe(0);
  });

  it("never folds inferred links", () => {
    const g = junction();
    const inferred = {
      ...g,
      links: g.links.map((l) => ({ ...l, inferred: true })),
    };
    expect(model(inferred).folded.size).toBe(0);
  });
});

describe("Mongo in ER", () => {
  const oid = (name: string) =>
    col(name, { data_type: "objectid", primary_key: name === "_id" });
  const posts = table("posts", [oid("_id"), oid("userId"), oid("tagIds")]);
  const inferred = (field: string, to: string, array = false) =>
    link("posts", [field], to, {
      id: `posts.${field}`,
      to_columns: ["_id"],
      inferred: true,
      array,
    });
  const graph: SchemaGraph = {
    tables: [posts, table("users", [oid("_id")]), table("tags", [oid("_id")])],
    links: [inferred("userId", "users"), inferred("tagIds", "tags", true)],
  };
  const marks = (g: SchemaGraph) =>
    Object.fromEntries(
      buildErModel(g, "all", fkColumns(g)).lines.map((l) => [l.id, l.mark]),
    );

  it("is zero or one at the referenced collection and zero or many behind it", () => {
    expect(marks(graph)).toMatchObject({
      "d:posts.userId:from": "many",
      "d:posts.userId:to": "zero-one",
    });
  });

  it("is zero or many at both ends of an array field", () => {
    expect(marks(graph)).toMatchObject({
      "d:posts.tagIds:from": "many",
      "d:posts.tagIds:to": "many",
    });
  });

  it("draws inferred diamonds dashed, and none once inferred links are hidden", () => {
    const model = buildErModel(graph, "all", fkColumns(graph));
    expect(model.diamonds.map((d) => [d.id, d.inferred])).toEqual([
      ["d:posts.userId", true],
      ["d:posts.tagIds", true],
    ]);
    expect(model.lines.every((l) => l.inferred)).toBe(true);
    const hidden = buildErModel({ ...graph, links: [] }, "all", new Map());
    expect(hidden.diamonds).toEqual([]);
    expect(hidden.lines).toEqual([]);
    expect(hidden.entities).toHaveLength(3);
  });
});

describe("the ER layout request", () => {
  it("runs referencing entity to diamond to referenced entity, with no ports", () => {
    const g: SchemaGraph = {
      tables: [users, table("posts", [col("author_id")])],
      links: [link("posts", ["author_id"], "users")],
    };
    const req = erLayoutRequest(buildErModel(g, "all", fkColumns(g)));
    expect(req.nodes.every((n) => n.ports === null)).toBe(true);
    expect(req.edges.map((e) => [e.source, e.target])).toEqual([
      ["posts", "d:posts#author_id"],
      ["d:posts#author_id", "users"],
    ]);
    const elk = toElkGraph(req);
    expect(elk.children[0]).not.toHaveProperty("ports");
    expect(elk.children[0].layoutOptions).toEqual({
      "elk.portConstraints": "FREE",
    });
    expect(elk.edges[0]).toMatchObject({
      sources: ["posts"],
      targets: ["d:posts#author_id"],
    });
  });
});

describe("clusterGeometry", () => {
  it("is just the rectangle with no ovals", () => {
    const g = clusterGeometry([]);
    expect(g.height).toBe(ENTITY_HEIGHT);
    expect(g.rect.y).toBe(0);
  });

  it("puts the first half of the ovals above and the rest below", () => {
    const cols = ["a", "b", "c", "d", "e"].map((n) => col(n));
    const g = clusterGeometry(cols);
    const above = g.ovals
      .filter((o) => o.y < g.rect.y)
      .map((o) => o.column.name);
    const below = g.ovals
      .filter((o) => o.y > g.rect.y)
      .map((o) => o.column.name);
    expect(above).toEqual(["a", "b", "c"]);
    expect(below).toEqual(["d", "e"]);
  });

  it("wraps past four ovals a row and keeps the sides free", () => {
    const cols = Array.from({ length: 10 }, (_, i) => col(`column_${i}`));
    const g = clusterGeometry(cols);
    const rows = new Set(g.ovals.map((o) => o.y));
    expect(rows.size).toBe(4);
    for (const o of g.ovals) {
      const overlapsRect =
        o.y < g.rect.y + g.rect.height && o.y + o.height > g.rect.y;
      expect(overlapsRect).toBe(false);
    }
  });

  it("clamps oval widths", () => {
    expect(ovalWidth("id")).toBe(64);
    expect(ovalWidth("a_really_long_column_name_that_goes_on")).toBe(140);
  });
});
