import { tabKey, tabLabel } from "./tab-utils";
import type { StudioStore } from "./types";

type UnappliedWorkState = Pick<
  StudioStore,
  "schemaEdits" | "gridBridges" | "newTables" | "sqlTabs"
>;

/** What a tab holds that would be lost if it closed now: schema drafts,
 *  unsaved grid row edits, or an unfinished new-table definition. With
 *  `include_queries`, also unsaved SQL text — wanted when closing a tab, not
 *  when restarting the app (the workspace snapshot already saves and
 *  restores query text). */
export function summarizeUnappliedWork(
  s: UnappliedWorkState,
  key: string,
  { include_queries = false }: { include_queries?: boolean } = {},
): string[] {
  const parts: string[] = [];
  const se = s.schemaEdits[key];
  if (se) parts.push(`${se.count} schema change${se.count === 1 ? "" : "s"}`);
  const gb = s.gridBridges[key];
  if (gb?.pending_exists)
    parts.push(
      `${gb.pending_count} unsaved row edit${gb.pending_count === 1 ? "" : "s"}`,
    );
  const nt = s.newTables[key];
  if (nt?.has_draft) parts.push("table definition");
  if (include_queries && s.sqlTabs[key]?.is_dirty) parts.push("unsaved queries");
  return parts;
}

/** Every open tab, across all connections, that holds unapplied work — what
 *  the update dialog lists before a restart throws it away. */
export function listUnappliedWork(
  s: UnappliedWorkState & Pick<StudioStore, "workspaces">,
): { label: string; parts: string[] }[] {
  const out: { label: string; parts: string[] }[] = [];
  for (const ws of Object.values(s.workspaces)) {
    for (const tab of ws.tabs) {
      const parts = summarizeUnappliedWork(s, tabKey(tab));
      if (parts.length > 0) out.push({ label: tabLabel(tab), parts });
    }
  }
  return out;
}
