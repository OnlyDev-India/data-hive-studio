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
    case "activity":
      return "Activity";
  }
}

/** Unique key per tab instance (multiple tabs can show the same table). */
export function tabKey(tab: StudioTab): string {
  switch (tab.kind) {
    case "table":
      return `table:${tab.tabId}:${tab.name}`;
    case "sql":
      return `sql:${tab.id}`;
    case "new-table":
      return `new-table:${tab.id}`;
    case "activity":
      return "activity";
  }
}

/** Whether two tabs are the same instance. */
export function tabEquals(a: StudioTab, b: StudioTab | null): boolean {
  if (!b) return false;
  if (a.kind !== b.kind) return false;
  if (a.kind === "table") return b.kind === "table" && a.tabId === b.tabId;
  if (a.kind === "sql" || a.kind === "new-table") {
    return (b.kind === "sql" || b.kind === "new-table") && a.id === b.id;
  }
  return true;
}
