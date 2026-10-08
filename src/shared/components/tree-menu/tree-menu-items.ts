import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileCode,
  FolderPlus,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  SquareTerminal,
  Star,
  Trash2,
  Unplug,
} from "lucide-react";
import type { SchemaObjectKind } from "@/shared/api";
import { READ_ONLY_TITLE, type MenuEntry } from "../table-menu";

/** `create` is the row's one "New …" item; the row decides what it makes. */
export type TreeAction =
  | "refresh"
  | "create"
  | "open"
  | "sql_tab"
  | "console"
  | "expand_all"
  | "copy_name"
  | "collapse_all"
  | "relation_diagram"
  | "set_default"
  | "close_tabs"
  | "drop_schema"
  | "disconnect";

export type TreeMenuItem = MenuEntry<TreeAction>;

export type TreeNode =
  | {
      kind: "pg_database";
      readOnly: boolean;
      canSetDefault: boolean;
      canDisconnect: boolean;
    }
  | {
      kind: "pg_schema";
      readOnly: boolean;
      isCurrentDb: boolean;
      isActiveSchema: boolean;
      isConnectedSchema: boolean;
      isPublic: boolean;
    }
  | { kind: "pg_category"; readOnly: boolean; category: SchemaObjectKind }
  | { kind: "pg_extensions"; readOnly: boolean }
  | { kind: "pg_roles"; readOnly: boolean }
  | { kind: "mongo_database"; readOnly: boolean; canSetDefault: boolean }
  | { kind: "sqlite_group"; readOnly: boolean; group: "table" | "view" }
  | { kind: "leaf" };

const CREATE_LABEL: Record<SchemaObjectKind, string> = {
  table: "New table",
  view: "New view",
  materialized_view: "New materialized view",
  procedure: "New procedure",
  function: "New function",
  sequence: "New sequence",
  type: "New type",
};

/** The menu for one sidebar tree row. Create items are disabled on a read
 *  only connection; everything else stays enabled. */
export function treeMenuItems(node: TreeNode): TreeMenuItem[] {
  const readOnly = node.kind !== "leaf" && node.readOnly;
  const ro = readOnly ? READ_ONLY_TITLE : undefined;
  const item = (
    action: TreeAction,
    label: string,
    icon: TreeMenuItem["icon"],
  ): TreeMenuItem => ({ action, label, icon, disabled: false });
  const create = (label: string, icon = Plus): TreeMenuItem => ({
    action: "create",
    label,
    icon,
    disabled: readOnly,
    title: ro,
  });
  const refresh = (label = "Refresh") => item("refresh", label, RefreshCw);
  const copy = (label = "Copy name") => item("copy_name", label, Copy);
  const sqlTab = item("sql_tab", "New SQL tab here", FileCode);
  const collapse = item("collapse_all", "Collapse all", ChevronsDownUp);
  const diagram = item("relation_diagram", "Open relation diagram", Network);
  const setDefault = item("set_default", "Set as default", Star);
  const disconnect: TreeMenuItem = {
    ...item("disconnect", "Disconnect", Unplug),
    destructive: true,
    separatorBefore: true,
  };

  switch (node.kind) {
    case "pg_category":
      return [refresh(), create(CREATE_LABEL[node.category])];
    case "pg_extensions":
      return [refresh(), create("New extension")];
    case "pg_roles":
      return [item("open", "Open", ShieldCheck), create("New role")];
    case "sqlite_group":
      return [refresh(), create(CREATE_LABEL[node.group])];
    case "leaf":
      return [copy()];
    case "pg_database":
      return [
        refresh(),
        create("New schema…", FolderPlus),
        sqlTab,
        copy(),
        collapse,
        ...(node.canSetDefault ? [setDefault] : []),
        ...(node.canDisconnect ? [disconnect] : []),
      ];
    case "pg_schema":
      return [
        refresh(),
        create("New table here"),
        sqlTab,
        item("expand_all", "Expand all categories", ChevronsUpDown),
        copy(),
        collapse,
        diagram,
        ...(node.isConnectedSchema && !node.isActiveSchema
          ? [item("close_tabs", "Close open tabs", Trash2)]
          : []),
        ...(node.isCurrentDb
          ? [
              {
                action: "drop_schema",
                label: "Drop schema…",
                icon: Trash2,
                disabled: node.isPublic || readOnly,
                title: ro,
                destructive: true,
                separatorBefore: true,
              } satisfies TreeMenuItem,
            ]
          : []),
      ];
    case "mongo_database":
      return [
        refresh("Refresh collections"),
        create("New collection…"),
        item("console", "New console here", SquareTerminal),
        copy("Copy database name"),
        diagram,
        ...(node.canSetDefault ? [setDefault] : []),
        disconnect,
      ];
  }
}
