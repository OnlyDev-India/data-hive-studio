import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import type { TableSchema } from "@/shared/api";

const schemas: Record<string, TableSchema> = {
  teams: {
    columns: [
      { name: "name", data_type: "string", not_null: false, primary_key: false, default: null },
      { name: "age", data_type: "int", not_null: false, primary_key: false, default: null },
    ],
    foreign_keys: [],
    indexes: [],
    triggers: [],
  },
};

vi.mock("@/shared/api", () => ({
  tableSchema: vi.fn((_connId: string, table: string) => {
    const s = schemas[table];
    return s ? Promise.resolve(s) : Promise.reject(new Error("no such collection"));
  }),
}));

const { nosqlConsoleCompletions, NOSQL_SHELL_COMPLETIONS } = await import("./nosql-completions");

function ctxFor(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, false);
}

describe("nosqlConsoleCompletions", () => {
  const collections = [{ label: "teams", type: "property" as const }];

  it("suggests collections + db-level aggregate right after db. — never collection methods", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db."));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("teams");
    // `aggregate` has a real database-level form (db.aggregate(...), for
    // pipelines that don't start from a collection) — offered here — but
    // collection-only methods like `find` never make sense without one.
    expect(labels).toContain("aggregate");
    expect(labels).not.toContain("find");
  });

  it("suggests ONLY (collection) methods right after db.<collection>. — never collections", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams."));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("aggregate");
    expect(labels).toContain("find");
    expect(labels).not.toContain("teams");
  });

  it("filters collections by partial prefix (db.te)", async () => {
    const source = nosqlConsoleCompletions(
      "c1",
      NOSQL_SHELL_COMPLETIONS,
      [{ label: "teams", type: "property" }, { label: "orders", type: "property" }],
    );
    const result = await source(ctxFor("db.te"));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("teams");
  });

  it("suggests field names + top-level logical operators at a find() filter's top level", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams.find({"));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("age");
    expect(labels).toContain("$or");
    expect(labels).toContain("$and");
    // Field-level comparison operators don't belong at the TOP of the filter.
    expect(labels).not.toContain("$gt");
  });

  it("suggests field names when typing inside an open quote for a key", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const doc = 'db.teams.find({"na';
    const result = await source(ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    // Replacement should start right after the opening quote, not include it.
    expect(result?.from).toBe(doc.length - 2);
  });

  it("suggests comparison operators one level inside a field's condition object", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams.find({age: {"));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("$gt");
    expect(labels).toContain("$in");
    expect(labels).toContain("$exists");
    // Not field names or top-level logical operators at this depth.
    expect(labels).not.toContain("name");
    expect(labels).not.toContain("$or");
  });

  it("suggests aggregation stage names as a pipeline stage's key", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams.aggregate([{"));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("$match");
    expect(labels).toContain("$group");
    expect(labels).not.toContain("name");
  });

  it("suggests field names inside a $match stage's own filter body", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams.aggregate([{$match: {"));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("$or");
  });

  it("suggests update operators at an update document's top level (2nd arg)", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor('db.teams.updateOne({name:"a"}, {'));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("$set");
    expect(labels).toContain("$inc");
    expect(labels).not.toContain("$or");
  });

  it("suggests field names inside $set's value (2nd arg, one level deeper)", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor('db.teams.updateOne({name:"a"}, {$set: {'));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("age");
    expect(labels).not.toContain("$set");
  });

  it("suggests only field names (no operators) inside insertOne's document", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams.insertOne({"));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).not.toContain("$or");
  });

  it("operator completions insert a snippet, not just the bare key", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor("db.teams.find({"));
    const and = result?.options.find((o) => o.label === "$and");
    const gt = (await source(ctxFor("db.teams.find({age: {")))?.options.find(
      (o) => o.label === "$gt",
    );
    expect(typeof and?.apply).toBe("function");
    expect(typeof gt?.apply).toBe("function");
  });

  it("returns null (falls through) at a value position, not a key position", async () => {
    const source = nosqlConsoleCompletions("c1", NOSQL_SHELL_COMPLETIONS, collections);
    const result = await source(ctxFor('db.teams.find({name: "a'));
    // No static suggestion list applies to a string VALUE — shell fallback
    // prefix-matches against methods/collections/keywords, none of which
    // match "a" meaningfully as a collection/method, so options should not
    // contain field names or operators.
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).not.toContain("name");
    expect(labels).not.toContain("$gt");
  });
});
