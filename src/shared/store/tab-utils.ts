import type { GridFilter } from "@/shared/components/data-grid/types";

export type StudioTab =
  | {
      kind: "table";
      name: string;
      tabId: number;
      initialFilters?: GridFilter[];
    }
  | { kind: "sql"; id: number }
  | { kind: "new-table"; id: number }
  | { kind: "mongo"; conn_id: string; database: string; collection: string; tabId: number }
  /** MongoDB console (JSON query / aggregate / shell subset). Multiple per
   *  connection are allowed, like SQL editors. `database` is the console's
   *  initial db context (switchable via `use <db>` inside the editor). */
  | { kind: "mongo-console"; conn_id: string; database: string; id: number }
  /** Singleton per connection — shows the currently selected activity entry. */
  | { kind: "activity" };

export function tabLabel(tab: StudioTab): string {
  switch (tab.kind) {
    case "table":
      return tab.name;
    case "sql":
      return tab.id === 0 ? "SQL" : `SQL ${tab.id + 1}`;
    case "new-table":
      return tab.id === 0 ? "New table" : `New table ${tab.id + 1}`;
    case "mongo":
      return tab.collection;
    case "mongo-console":
      return tab.id === 0 ? "NoSQL console" : `NoSQL console ${tab.id + 1}`;
    case "activity":
      return "Activity";
  }
}

export function tabKey(tab: StudioTab): string {
  switch (tab.kind) {
    case "table":
      return `table:${tab.tabId}:${tab.name}`;
    case "sql":
      return `sql:${tab.id}`;
    case "new-table":
      return `new-table:${tab.id}`;
    case "mongo":
      return `mongo:${tab.conn_id}:${tab.database}.${tab.collection}:${tab.tabId}`;
    case "mongo-console":
      return `mongo-console:${tab.conn_id}:${tab.id}`;
    case "activity":
      return "activity";
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
      b.kind === "mongo-console" &&
      a.conn_id === b.conn_id &&
      a.id === b.id
    );
  }
  return true;
}