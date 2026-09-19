import { describe, it, expect } from "vitest";
import { listUnappliedWork, summarizeUnappliedWork } from "../unapplied-work";
import { tabKey, type StudioTab } from "../tab-utils";

type Args = Parameters<typeof summarizeUnappliedWork>[0];
type ListArgs = Parameters<typeof listUnappliedWork>[0];

/** Only the fields the helper reads; the handles hold callbacks the helper
 *  never touches, so they are cast rather than faked in full. */
function state(parts: Partial<Record<keyof Args, unknown>> = {}): Args {
  return {
    schemaEdits: {},
    gridBridges: {},
    newTables: {},
    sqlTabs: {},
    ...parts,
  } as Args;
}

describe("summarizeUnappliedWork", () => {
  it("returns nothing for a tab with no unapplied work", () => {
    expect(summarizeUnappliedWork(state(), "table:1")).toEqual([]);
  });

  it("counts schema changes, singular and plural", () => {
    const one = state({ schemaEdits: { k: { count: 1 } } });
    const three = state({ schemaEdits: { k: { count: 3 } } });

    expect(summarizeUnappliedWork(one, "k")).toEqual(["1 schema change"]);
    expect(summarizeUnappliedWork(three, "k")).toEqual(["3 schema changes"]);
  });

  it("counts staged row edits only while some are pending, singular and plural", () => {
    const one = state({
      gridBridges: { k: { pending_exists: true, pending_count: 1 } },
    });
    const many = state({
      gridBridges: { k: { pending_exists: true, pending_count: 4 } },
    });
    const none = state({
      gridBridges: { k: { pending_exists: false, pending_count: 4 } },
    });

    expect(summarizeUnappliedWork(one, "k")).toEqual(["1 unsaved row edit"]);
    expect(summarizeUnappliedWork(many, "k")).toEqual(["4 unsaved row edits"]);
    expect(summarizeUnappliedWork(none, "k")).toEqual([]);
  });

  it("reports an unfinished new table only while it has a draft", () => {
    const draft = state({ newTables: { k: { has_draft: true } } });
    const empty = state({ newTables: { k: { has_draft: false } } });

    expect(summarizeUnappliedWork(draft, "k")).toEqual(["table definition"]);
    expect(summarizeUnappliedWork(empty, "k")).toEqual([]);
  });

  it("tolerates a null handle left behind by a cleared tab", () => {
    const s = state({ schemaEdits: { k: null }, gridBridges: { k: null } });

    expect(summarizeUnappliedWork(s, "k")).toEqual([]);
  });

  it("lists every kind at once, in a stable order", () => {
    const s = state({
      schemaEdits: { k: { count: 2 } },
      gridBridges: { k: { pending_exists: true, pending_count: 1 } },
      newTables: { k: { has_draft: true } },
    });

    expect(summarizeUnappliedWork(s, "k")).toEqual([
      "2 schema changes",
      "1 unsaved row edit",
      "table definition",
    ]);
  });

  it("ignores unsaved SQL text by default, since a restart restores it", () => {
    const s = state({ sqlTabs: { k: { is_dirty: true } } });

    expect(summarizeUnappliedWork(s, "k")).toEqual([]);
  });

  it("includes unsaved SQL text when closing a tab asks for it", () => {
    const dirty = state({ sqlTabs: { k: { is_dirty: true } } });
    const clean = state({ sqlTabs: { k: { is_dirty: false } } });

    expect(
      summarizeUnappliedWork(dirty, "k", { include_queries: true }),
    ).toEqual(["unsaved queries"]);
    expect(
      summarizeUnappliedWork(clean, "k", { include_queries: true }),
    ).toEqual([]);
  });

  it("only reads the tab key it was asked about", () => {
    const s = state({ schemaEdits: { other: { count: 5 } } });

    expect(summarizeUnappliedWork(s, "k")).toEqual([]);
  });
});

describe("listUnappliedWork", () => {
  const users: StudioTab = { kind: "table", name: "users", tabId: 1 };
  const orders: StudioTab = { kind: "table", name: "orders", tabId: 2 };
  const draft: StudioTab = { kind: "new-table", id: 0 };
  const sql: StudioTab = { kind: "sql", id: 0 };

  function withWorkspaces(
    workspaces: Record<string, StudioTab[]>,
    parts: Partial<Record<keyof Args, unknown>> = {},
  ): ListArgs {
    return {
      ...state(parts),
      workspaces: Object.fromEntries(
        Object.entries(workspaces).map(([id, tabs]) => [id, { tabs }]),
      ),
    } as ListArgs;
  }

  it("returns an empty list when nothing is open", () => {
    expect(listUnappliedWork(withWorkspaces({}))).toEqual([]);
  });

  it("returns an empty list when every tab is clean", () => {
    expect(listUnappliedWork(withWorkspaces({ c1: [users, sql] }))).toEqual([]);
  });

  it("labels each affected tab with what it would lose", () => {
    const s = withWorkspaces(
      { c1: [users] },
      {
        gridBridges: {
          [tabKey(users)]: { pending_exists: true, pending_count: 3 },
        },
      },
    );

    expect(listUnappliedWork(s)).toEqual([
      { label: "users", parts: ["3 unsaved row edits"] },
    ]);
  });

  it("walks every connection's workspace and skips clean tabs", () => {
    const s = withWorkspaces(
      { c1: [users, sql], c2: [orders, draft] },
      {
        schemaEdits: { [tabKey(orders)]: { count: 1 } },
        newTables: { [tabKey(draft)]: { has_draft: true } },
        gridBridges: {
          [tabKey(users)]: { pending_exists: true, pending_count: 1 },
        },
      },
    );

    expect(listUnappliedWork(s)).toEqual([
      { label: "users", parts: ["1 unsaved row edit"] },
      { label: "orders", parts: ["1 schema change"] },
      { label: "New table", parts: ["table definition"] },
    ]);
  });

  it("does not list a SQL tab that only has unsaved text", () => {
    const s = withWorkspaces(
      { c1: [sql] },
      { sqlTabs: { [tabKey(sql)]: { is_dirty: true } } },
    );

    expect(listUnappliedWork(s)).toEqual([]);
  });
});
