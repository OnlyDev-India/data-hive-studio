import { describe, expect, it } from "vitest";
import { READ_ONLY_TITLE } from "@/shared/components/table-menu";
import { treeMenuItems, type TreeNode } from "../tree-menu-items";
import { createTemplate } from "../create-template";

const labels = (node: TreeNode) => treeMenuItems(node).map((i) => i.label);
const byLabel = (node: TreeNode, label: string) =>
  treeMenuItems(node).find((i) => i.label === label);

const pgDb = {
  kind: "pg_database",
  readOnly: false,
  canSetDefault: true,
  canDisconnect: true,
} as const;
const pgSchema = {
  kind: "pg_schema",
  readOnly: false,
  isCurrentDb: true,
  isActiveSchema: false,
  isConnectedSchema: true,
  isPublic: false,
} as const;
const mongoDb = {
  kind: "mongo_database",
  readOnly: false,
  canSetDefault: true,
} as const;

describe("treeMenuItems", () => {
  it.each([
    ["table", "New table"],
    ["view", "New view"],
    ["materialized_view", "New materialized view"],
    ["procedure", "New procedure"],
    ["function", "New function"],
    ["sequence", "New sequence"],
    ["type", "New type"],
  ] as const)("offers Refresh and New on the %s header", (category, label) => {
    expect(labels({ kind: "pg_category", readOnly: false, category })).toEqual([
      "Refresh",
      label,
    ]);
  });

  it("offers Refresh and New extension on Extensions", () => {
    expect(labels({ kind: "pg_extensions", readOnly: false })).toEqual([
      "Refresh",
      "New extension",
    ]);
  });

  it("offers Open and New role on Users & Privileges", () => {
    expect(labels({ kind: "pg_roles", readOnly: false })).toEqual([
      "Open",
      "New role",
    ]);
  });

  it("gives every Postgres database row the common set", () => {
    expect(labels(pgDb)).toEqual([
      "Refresh",
      "New schema…",
      "New SQL tab here",
      "Copy name",
      "Collapse all",
      "Set as default",
      "Disconnect",
    ]);
    expect(
      labels({ ...pgDb, canSetDefault: false, canDisconnect: false }),
    ).toEqual([
      "Refresh",
      "New schema…",
      "New SQL tab here",
      "Copy name",
      "Collapse all",
    ]);
    const disconnect = byLabel(pgDb, "Disconnect");
    expect(disconnect?.destructive).toBe(true);
    expect(disconnect?.separatorBefore).toBe(true);
  });

  it("gives a Postgres schema row its set plus today's items", () => {
    expect(labels(pgSchema)).toEqual([
      "Refresh",
      "New table here",
      "New SQL tab here",
      "Expand all categories",
      "Copy name",
      "Collapse all",
      "Open relation diagram",
      "Close open tabs",
      "Drop schema…",
    ]);
    expect(
      labels({
        ...pgSchema,
        isCurrentDb: false,
        isConnectedSchema: false,
      }),
    ).not.toContain("Drop schema…");
    expect(labels({ ...pgSchema, isActiveSchema: true })).not.toContain(
      "Close open tabs",
    );
    expect(
      byLabel({ ...pgSchema, isPublic: true }, "Drop schema…")?.disabled,
    ).toBe(true);
  });

  it("gives a Mongo database row its set plus today's items", () => {
    expect(labels(mongoDb)).toEqual([
      "Refresh collections",
      "New collection…",
      "New console here",
      "Copy database name",
      "Open relation diagram",
      "Set as default",
      "Disconnect",
    ]);
    expect(labels({ ...mongoDb, canSetDefault: false })).not.toContain(
      "Set as default",
    );
  });

  it("offers Refresh and New on the SQLite groups", () => {
    expect(
      labels({ kind: "sqlite_group", readOnly: false, group: "table" }),
    ).toEqual(["Refresh", "New table"]);
    expect(
      labels({ kind: "sqlite_group", readOnly: false, group: "view" }),
    ).toEqual(["Refresh", "New view"]);
  });

  it("offers Copy name on a single name", () => {
    expect(labels({ kind: "leaf" })).toEqual(["Copy name"]);
  });

  it("disables every create item on a read only connection, and nothing else", () => {
    const nodes: TreeNode[] = [
      { ...pgDb, readOnly: true },
      { ...pgSchema, readOnly: true },
      { kind: "pg_category", readOnly: true, category: "view" },
      { kind: "pg_extensions", readOnly: true },
      { kind: "pg_roles", readOnly: true },
      { ...mongoDb, readOnly: true },
      { kind: "sqlite_group", readOnly: true, group: "view" },
    ];
    for (const node of nodes)
      for (const item of treeMenuItems(node)) {
        const writes =
          item.action === "create" || item.action === "drop_schema";
        expect(item.disabled, `${node.kind} ${item.label}`).toBe(writes);
        expect(item.title, `${node.kind} ${item.label}`).toBe(
          writes ? READ_ONLY_TITLE : undefined,
        );
      }
  });
});

describe("createTemplate", () => {
  it("qualifies Postgres objects with the quoted schema", () => {
    expect(createTemplate("view", "sales", "pg")).toBe(
      'CREATE VIEW "sales".new_view AS\nSELECT\n  1;',
    );
    expect(createTemplate("sequence", 'we"ird', "pg")).toBe(
      'CREATE SEQUENCE "we""ird".new_sequence\n  START WITH 1\n  INCREMENT BY 1;',
    );
    expect(createTemplate("search_path", "sales", "pg")).toBe(
      'SET search_path TO "sales";\n\n',
    );
  });

  it("starts each kind with its CREATE statement", () => {
    expect(createTemplate("materialized_view", "s", "pg")).toMatch(
      /^CREATE MATERIALIZED VIEW "s"\.new_view AS[\s\S]*WITH DATA;$/,
    );
    expect(createTemplate("function", "s", "pg")).toMatch(
      /^CREATE FUNCTION "s"\.new_function\(\)/,
    );
    expect(createTemplate("procedure", "s", "pg")).toMatch(
      /^CREATE PROCEDURE "s"\.new_procedure\(\)/,
    );
    expect(createTemplate("type", "s", "pg")).toBe(
      "CREATE TYPE \"s\".new_type AS ENUM ('a', 'b');",
    );
    expect(createTemplate("extension", undefined, "pg")).toBe(
      "CREATE EXTENSION IF NOT EXISTS extension_name;",
    );
    expect(createTemplate("role", undefined, "pg")).toBe(
      "CREATE ROLE role_name WITH LOGIN PASSWORD 'change_me';",
    );
  });

  it("writes an unqualified view for SQLite", () => {
    expect(createTemplate("view", undefined, "sqlite")).toBe(
      "CREATE VIEW new_view AS\nSELECT\n  1;",
    );
  });
});
