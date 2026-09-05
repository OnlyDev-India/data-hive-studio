import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { schemaCompletions } from "./sql-completions";

function ctxFor(doc: string, pos = doc.length) {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, false);
}

// `CompletionSource`'s type allows returning a Promise, but every source in
// this file always resolves synchronously — narrow it back for the tests
// below rather than threading `await` through each one for a case that
// can't actually happen here.
function runSync(
  source: ReturnType<typeof schemaCompletions>,
  ctx: CompletionContext,
): CompletionResult | null {
  return source(ctx) as CompletionResult | null;
}

describe("schemaCompletions", () => {
  const schema = {
    users: [
      { label: "id", type: "property" as const },
      { label: "name", type: "property" as const },
      { label: "email", type: "property" as const },
    ],
    orders: [
      { label: "id", type: "property" as const },
      { label: "total", type: "property" as const },
    ],
  };

  it("suggests columns after WHERE once a table's been named in FROM — WITHOUT typing tablename.", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT * FROM users WHERE ";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("email");
    expect(labels).not.toContain("total");
  });

  it("suggests columns in the SELECT list once a table's been named in FROM", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT  FROM users";
    // Cursor right after "SELECT " (before the extra space/FROM).
    const result = runSync(source, ctxFor(doc, 7));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("id");
    expect(labels).toContain("name");
  });

  it("still supports the explicit table. / alias. dotted form", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT * FROM users WHERE users.";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("email");
  });

  it("combines columns from every table referenced via JOIN", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT * FROM users JOIN orders ON users.id = orders.id WHERE ";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("email");
    expect(labels).toContain("total");
  });

  it("resolves fields at a field position when the table has an alias (FROM users u)", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT * FROM users u WHERE ";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("email");
  });

  it("returns null when no table has been referenced yet", () => {
    const source = schemaCompletions(schema);
    const result = source(ctxFor("SELECT "));
    expect(result).toBeNull();
  });

  it("suggests columns in the INSERT INTO column list", () => {
    const source = schemaCompletions(schema);
    const doc = "INSERT INTO users (";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("id");
    expect(labels).toContain("name");
    expect(labels).toContain("email");
  });

  it("suggests columns after a comma in the INSERT INTO column list", () => {
    const source = schemaCompletions(schema);
    const doc = "INSERT INTO users (id, ";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("email");
  });

  it("suggests columns after UPDATE ... SET", () => {
    const source = schemaCompletions(schema);
    const doc = "UPDATE users SET ";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("email");
  });

  it("suggests columns after a comma in a multi-column UPDATE ... SET", () => {
    const source = schemaCompletions(schema);
    const doc = "UPDATE users SET name = 'x', ";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("email");
  });

  it("scopes suggestions to the statement the cursor is in, not the whole multi-statement script", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT * FROM users WHERE ;\nINSERT INTO orders (";
    // Cursor inside the first (SELECT ... users) statement.
    const result = runSync(source, ctxFor(doc, doc.indexOf("WHERE ") + 6));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("name");
    expect(labels).toContain("email");
    expect(labels).not.toContain("total");
  });

  it("scopes suggestions to the second statement of a multi-statement script", () => {
    const source = schemaCompletions(schema);
    const doc = "SELECT * FROM users WHERE id = 1;\nINSERT INTO orders (";
    const result = runSync(source, ctxFor(doc));
    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("total");
    expect(labels).not.toContain("name");
    expect(labels).not.toContain("email");
  });
});
