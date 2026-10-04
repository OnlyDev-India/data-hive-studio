import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { libraryCompletions } from "../completions";
import type { LibraryItem } from "../types";

const items: LibraryItem[] = [
  {
    id: "1",
    kind: "snippet",
    language: "sql",
    name: "Select rows",
    text: "SELECT ${1:*} FROM ${2:table} \\{x\\};",
    trigger: "sel",
    created_at: 1,
    updated_at: 1,
  },
  {
    id: "2",
    kind: "query",
    language: "sql",
    name: "Active users",
    text: "SELECT * FROM users WHERE note = '${1:literal}';",
    trigger: null,
    created_at: 1,
    updated_at: 1,
  },
  {
    id: "3",
    kind: "snippet",
    language: "mongo",
    name: "Find documents",
    text: "db.${1:collection}.find({})",
    trigger: "find",
    created_at: 1,
    updated_at: 1,
  },
];

function complete(language: "sql" | "mongo", doc: string, explicit = false) {
  const state = EditorState.create({ doc });
  const source = libraryCompletions(language, () => items);
  return source(
    new CompletionContext(state, doc.length, explicit),
  ) as CompletionResult | null;
}

const labels = (r: CompletionResult | null) => r?.options.map((o) => o.label);

describe("libraryCompletions", () => {
  it("offers only items of the editor's language", () => {
    expect(labels(complete("sql", "se"))).toEqual([
      "sel",
      "Select rows",
      "Active users",
    ]);
    expect(labels(complete("mongo", "fi"))).toEqual(["find", "Find documents"]);
  });

  it("matches a snippet on trigger and name, and a query on name only", () => {
    const r = complete("sql", "x");
    const query = r?.options.filter((o) => o.detail === "query");
    expect(query?.map((o) => o.label)).toEqual(["Active users"]);
  });

  it("ranks below schema and keyword completions", () => {
    for (const o of complete("sql", "se")?.options ?? [])
      expect(o.boost).toBeLessThan(0);
  });

  it("stays quiet with no typed word unless asked", () => {
    expect(complete("sql", "SELECT ")).toBeNull();
    expect(complete("sql", "SELECT ", true)?.options.length).toBe(3);
  });

  it("replaces the typed word from its start", () => {
    expect(complete("sql", "SELECT 1; se")?.from).toBe(10);
  });
});

function applyIn(doc: string, option: Completion) {
  const view = new EditorView({
    state: EditorState.create({ doc }),
  });
  view.dispatch({ selection: { anchor: doc.length } });
  const from = doc.length - 3;
  (
    option.apply as (v: EditorView, c: Completion, f: number, t: number) => void
  )(view, option, from, doc.length);
  const text = view.state.doc.toString();
  view.destroy();
  return text;
}

describe("applying a library item", () => {
  it("expands a snippet's fields and literal braces", () => {
    const option = complete("sql", "sel")!.options[0];
    expect(applyIn("-- sel", option)).toBe("-- SELECT * FROM table {x};");
  });

  it("inserts a saved query literally", () => {
    const option = complete("sql", "act")!.options.find(
      (o) => o.label === "Active users",
    )!;
    expect(applyIn("-- act", option)).toBe(
      "-- SELECT * FROM users WHERE note = '${1:literal}';",
    );
  });
});
