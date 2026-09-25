import type { GridFilter } from "@/shared/components/data-grid/types";

export type StudioTab =
  | {
      kind: "table";
      name: string;
      tabId: number;
      initialFilters?: GridFilter[];
      /** Postgres only. `undefined` = this connection's own primary
       *  database/active schema — every existing tab keeps this behavior
       *  with no migration. Set when a table is opened from a database/
       *  schema other than the connection's own (the sidebar catalog
       *  tree's multi-database browsing), so this tab keeps querying ITS
       *  target even while other tabs stay on (or switch to) a different
       *  one — see `open_object` in tables-view.tsx. */
      database?: string;
      schema?: string;
    }
  /** `conn_id` keeps the key unique across connections: `id` is a
   *  per-connection counter, and the store's per-tab maps (`sqlSeeds`,
   *  `sqlTabs`, ...) are global, so `sql:0` in two connections used to be
   *  the same entry. Absent only on tabs saved before this field existed
   *  (see `stampLegacySqlTabs`). */
  | { kind: "sql"; id: number; conn_id?: string }
  | { kind: "new-table"; id: number }
  | {
      kind: "mongo";
      conn_id: string;
      database: string;
      collection: string;
      tabId: number;
    }
  /** MongoDB console (JSON query / aggregate / shell subset). Multiple per
   *  connection are allowed, like SQL editors. `database` is the console's
   *  initial db context (switchable via `use <db>` inside the editor). */
  | { kind: "mongo-console"; conn_id: string; database: string; id: number }
  /** Singleton per connection — shows the currently selected activity entry. */
  | { kind: "activity" }
  /** Singleton per connection — the Users & Privileges tab (Postgres roles). */
  | { kind: "roles" };

/** `file_name`, when set, overrides the generic label for "sql"/"mongo-console"
 *  tabs once they've been saved to a file — see `SqlTabHandleBase.file_name`.
 *  A SQL tab without a file is named `sql@<database>` after the database
 *  selected in it (`SqlTabHandleBase.database`); until the editor has
 *  registered one it keeps the generic numbered label. */
export function tabLabel(
  tab: StudioTab,
  file_name?: string | null,
  database?: string | null,
): string {
  if (file_name) return file_name;
  if (tab.kind === "sql" && database) return `sql@${database}`;
  switch (tab.kind) {
    case "table":
      return tab.name;
    case "sql":
      return tab.id === 0 ? "SQL" : `SQL ${tab.id + 1}`;
    case "new-table":
      return "New table";
    case "mongo":
      return tab.collection;
    case "mongo-console":
      return tab.id === 0 ? "NoSQL console" : `NoSQL console ${tab.id + 1}`;
    case "activity":
      return "Activity";
    case "roles":
      return "Users & Privileges";
  }
}

export function tabKey(tab: StudioTab): string {
  switch (tab.kind) {
    case "table":
      return `table:${tab.tabId}:${tab.database ?? ""}.${tab.schema ?? ""}.${tab.name}`;
    case "sql":
      return tab.conn_id ? `sql:${tab.conn_id}:${tab.id}` : `sql:${tab.id}`;
    case "new-table":
      return `new-table:${tab.id}`;
    case "mongo":
      return `mongo:${tab.conn_id}:${tab.database}.${tab.collection}:${tab.tabId}`;
    case "mongo-console":
      return `mongo-console:${tab.conn_id}:${tab.id}`;
    case "activity":
      return "activity";
    case "roles":
      return "roles";
  }
}

export function tabEquals(a: StudioTab, b: StudioTab | null): boolean {
  if (!b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "table") return b.kind === "table" && a.tabId === b.tabId;
  if (a.kind === "sql" || a.kind === "new-table") {
    return (b.kind === "sql" || b.kind === "new-table") && a.id === b.id;
  }
  if (a.kind === "mongo") {
    return (
      b.kind === "mongo" &&
      a.conn_id === b.conn_id &&
      a.database === b.database &&
      a.collection === b.collection &&
      a.tabId === b.tabId
    );
  }
  if (a.kind === "mongo-console") {
    return (
      b.kind === "mongo-console" && a.conn_id === b.conn_id && a.id === b.id
    );
  }
  return true;
}
