import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { linter, forceLinting, forEachDiagnostic } from "@codemirror/lint";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { nosqlSyntaxLinter } from "./nosql-lint";

/** `linter()`'s source always resolves via `Promise.resolve(...).then(...)`
 *  even for a purely synchronous source function — needs a tick before the
 *  dispatched diagnostics are visible on `view.state`. */
async function lint(doc: string, collections: string[] = []) {
  const state = EditorState.create({
    doc,
    extensions: [javascriptLanguage, linter(nosqlSyntaxLinter(collections))],
  });
  const view = new EditorView({ state, parent: document.body });
  forceLinting(view);
  await new Promise((r) => setTimeout(r, 0));
  const diagnostics: { from: number; to: number; message: string }[] = [];
  forEachDiagnostic(view.state, (d) =>
    diagnostics.push({ from: d.from, to: d.to, message: d.message }),
  );
  view.destroy();
  return diagnostics;
}

async function lintCount(doc: string, collections: string[] = []): Promise<number> {
  return (await lint(doc, collections)).length;
}

describe("nosqlSyntaxLinter", () => {
  it("does not flag ordinary shell commands as syntax errors", async () => {
    // This was the actual bug: `use`/`show` aren't valid JavaScript, so the
    // JS grammar (correctly) can't parse them — but they're completely
    // normal, common console commands, not mistakes.
    expect(await lintCount("use mydb")).toBe(0);
    expect(await lintCount("show dbs")).toBe(0);
    expect(await lintCount("show collections")).toBe(0);
  });

  it("does not flag a valid find/aggregate call", async () => {
    expect(
      await lintCount(`db.users.find({ status: "active" }).limit(10)`),
    ).toBe(0);
  });

  it("does not flag a pipeline formatted across multiple lines", async () => {
    const doc = [
      `db.orders.aggregate([`,
      `  { $match: { status: "A" } },`,
      `  { $group: { _id: "$cust" } }`,
      `])`,
    ].join("\n");
    expect(await lintCount(doc)).toBe(0);
  });

  it("still flags genuinely broken syntax", async () => {
    expect(
      await lintCount(`db.users.find({ status: "active" )`),
    ).toBeGreaterThan(0);
  });

  it("does not flag a single query split across multiple lines", async () => {
    expect(
      await lintCount(`db.orders\n  .find({ status: "A" })\n  .limit(5)`),
    ).toBe(0);
  });

  it("flags two queries with no ; between them as invalid — they'd run as one combined chunk", async () => {
    expect(await lintCount("db.users.find({})\ndb.orders.find({})")).toBeGreaterThan(0);
  });

  it("places the missing-; diagnostic at the end of the first query's line, not inside the next query", async () => {
    const first = "db.users.find({})";
    const doc = `${first}\ndb.orders.find({})`;
    const diagnostics = await lint(doc);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) {
      expect(d.from).toBe(first.length);
      expect(d.to).toBe(first.length);
    }
  });

  it("does not flag two queries when they ARE separated by ;", async () => {
    expect(await lintCount("db.users.find({});\ndb.orders.find({});")).toBe(0);
  });

  it("does not check collection names when the collection list hasn't loaded yet", async () => {
    expect(await lintCount("db.find.find({});", [])).toBe(0);
  });

  it("flags a collection name that doesn't exist on the connection", async () => {
    // The exact case reported: `find` used as a collection name (easy to
    // mistype/mix up with the `.find()` method right after it) when the
    // real collections are `users`/`orders`.
    const diagnostics = await lintCount("db.find.find({});", ["users", "orders"]);
    expect(diagnostics).toBeGreaterThan(0);
  });

  it("points the unknown-collection diagnostic at just the collection name", async () => {
    const doc = "db.find.find({});";
    const diagnostics = await lint(doc, ["users", "orders"]);
    const unknown = diagnostics.find((d) => d.message.includes("Unknown collection"));
    expect(unknown).toBeDefined();
    expect(doc.slice(unknown!.from, unknown!.to)).toBe("find");
  });

  it("does not flag a known collection", async () => {
    expect(await lintCount("db.users.find({});", ["users", "orders"])).toBe(0);
  });
});
