import type { ConnectionInfo } from "../api/types";
import { loadWorkspaceState, saveWorkspaceState } from "../api/workspace-state";
import { tabKey, type StudioTab } from "./tab-utils";
import { DEFAULT_WORKSPACE } from "./workspace";
import type { PaneNode } from "./pane-layout";
import type {
  AggregationSetup,
  QueryBuilderSetup,
  CompareSetup,
  SavedConnParams,
  SavedWorkspace,
  StudioStore,
} from "./types";

/** Identity a connection's saved workspace is filed under — NEVER the
 *  runtime `conn_id` (a fresh UUID every connect, per
 *  `crates/dh-core/src/db/mod.rs`'s `open_database`/`connect_postgres`/etc.
 *  — it can't survive a restart or even a manual disconnect/reconnect).
 *  `source_path` is the most precise identity available for a file-based
 *  SQLite connection; everything else falls back to kind+name, which is
 *  what the connect dialogs already treat as "the same target" for
 *  duplicate-tab detection (see `connections.ts`'s `sameConnectionTarget`). */
export function stableConnKey(
  conn: Pick<ConnectionInfo, "kind" | "name" | "source_path">,
): string {
  if (conn.kind === "sqlite" && conn.source_path) {
    return `sqlite:${conn.source_path}`;
  }
  return `${conn.kind}:${conn.name}`;
}

/** The `stableConnKey` of the connection a saved entry opens. A blank
 *  Postgres database connects to `postgres` (see `pgConnectParams`), and
 *  DocumentDB connects as `mongodb`. */
export function stableKeyOfSaved(
  params: Pick<SavedConnParams, "kind" | "database" | "source_path">,
): string {
  switch (params.kind) {
    case "sqlite":
      return `sqlite:${params.source_path ?? ""}`;
    case "postgres":
      return `postgres:${params.database.trim() || "postgres"}`;
    default:
      return `mongodb:${params.database.trim()}`;
  }
}

/** State with every diagram layout filed under `key` dropped, both pending
 *  and on open connections. Tabs are left alone. */
export function clearLayoutsFor(
  state: StudioStore,
  key: string,
): Pick<StudioStore, "pendingWorkspaceRestore" | "relationLayouts"> {
  let { pendingWorkspaceRestore, relationLayouts } = state;
  const pending = pendingWorkspaceRestore[key];
  if (pending?.relationLayouts) {
    const rest = { ...pending };
    delete rest.relationLayouts;
    pendingWorkspaceRestore = { ...pendingWorkspaceRestore, [key]: rest };
    // Kept alive only by its layouts: nothing is left to restore.
    if (rest.workspace.tabs.length === 0) delete pendingWorkspaceRestore[key];
  }
  for (const conn of state.open) {
    if (stableConnKey(conn) !== key || !relationLayouts[conn.id]) continue;
    relationLayouts = { ...relationLayouts };
    delete relationLayouts[conn.id];
  }
  return { pendingWorkspaceRestore, relationLayouts };
}

/** Give SQL tabs saved before their key carried a connection (`sql:0`) the
 *  connection they're being restored into, so they stop sharing store
 *  entries with another connection's same-numbered tab. Rewrites every place
 *  the old key was stored: the tab list, the active tab, the pane layout and
 *  the saved editor text. Returns `saved` itself when nothing needs it. */
export function stampLegacySqlTabs(
  saved: SavedWorkspace,
  connId: string,
): SavedWorkspace {
  const renamed = new Map<string, string>();
  const tabs = saved.workspace.tabs.map((tab) => {
    if (tab.kind !== "sql" || tab.conn_id) return tab;
    const stamped = { ...tab, conn_id: connId };
    renamed.set(tabKey(tab), tabKey(stamped));
    return stamped;
  });
  if (renamed.size === 0) return saved;
  return rekeySaved(saved, tabs, renamed);
}

/** Diagram tabs saved as `er-diagram`, before the relation diagram rename,
 *  come back as `relation-diagram` tabs in the same pane. */
export function migrateDiagramTabs(saved: SavedWorkspace): SavedWorkspace {
  type Legacy = { kind: string; conn_id: string; id: number };
  const keyOf = (tab: StudioTab) => {
    const old = tab as unknown as Legacy;
    return old.kind === "er-diagram"
      ? `er-diagram:${old.conn_id}:${old.id}`
      : tabKey(tab);
  };
  const renamed = new Map<string, string>();
  const tabs = saved.workspace.tabs.map((tab) => {
    if ((tab as unknown as Legacy).kind !== "er-diagram") return tab;
    const next = { ...tab, kind: "relation-diagram" } as StudioTab;
    renamed.set(keyOf(tab), tabKey(next));
    return next;
  });
  const { nextErDiagramId, ...workspace } =
    saved.workspace as SavedWorkspace["workspace"] & {
      nextErDiagramId?: number;
    };
  if (renamed.size === 0 && nextErDiagramId === undefined) return saved;
  const moved: SavedWorkspace = {
    ...saved,
    workspace: {
      ...workspace,
      nextRelationDiagramId: workspace.nextRelationDiagramId ?? nextErDiagramId,
    },
  };
  return rekeySaved(moved, tabs, renamed, keyOf);
}

/** `saved` with `tabs` in place and every old key in `renamed` rewritten
 *  where a tab key is stored: the active tab, the pane layout and the
 *  saved editor text. */
function rekeySaved(
  saved: SavedWorkspace,
  tabs: StudioTab[],
  renamed: Map<string, string>,
  keyOf: (tab: StudioTab) => string = tabKey,
): SavedWorkspace {
  const rekey = (key: string) => renamed.get(key) ?? key;
  const rekeyLayout = (node: PaneNode): PaneNode =>
    node.type === "leaf"
      ? {
          ...node,
          tabKeys: node.tabKeys.map(rekey),
          activeTabKey: node.activeTabKey && rekey(node.activeTabKey),
        }
      : { ...node, children: node.children.map(rekeyLayout) };
  const { active } = saved.workspace;
  return {
    ...saved,
    workspace: {
      ...saved.workspace,
      tabs,
      active:
        active &&
        (tabs.find((t) => tabKey(t) === rekey(keyOf(active))) ?? active),
      layout: rekeyLayout(saved.workspace.layout),
    },
    sqlSeeds: Object.fromEntries(
      Object.entries(saved.sqlSeeds).map(([k, v]) => [rekey(k), v]),
    ),
  };
}

interface WorkspaceSnapshotV1 {
  version: 1;
  byConn: Record<string, SavedWorkspace>;
}

/** A connection's tabs plus their editor text and diagram layouts, or null
 *  with neither. Layouts alone keep an entry alive, with no tabs. */
export function savedWorkspaceOf(
  state: StudioStore,
  conn: ConnectionInfo,
): SavedWorkspace | null {
  // A SQLite with no file yet would share its key with every temp database.
  const layouts =
    conn.kind === "sqlite" && !conn.source_path
      ? undefined
      : state.relationLayouts[conn.id];
  const relationLayouts =
    layouts && Object.keys(layouts).length > 0 ? layouts : undefined;
  const found = state.workspaces[conn.id];
  const ws = found && found.tabs.length > 0 ? found : null;
  if (!ws && !relationLayouts) return null;
  if (!ws)
    return {
      workspace: found ?? DEFAULT_WORKSPACE,
      sqlSeeds: {},
      relationLayouts,
    };
  const sqlSeeds: Record<string, string> = {};
  const compareSetups: Record<string, CompareSetup> = {};
  const aggregationSetups: Record<string, AggregationSetup> = {};
  const queryBuilderSetups: Record<string, QueryBuilderSetup> = {};
  for (const tab of ws.tabs) {
    const tk = tabKey(tab);
    const seed = state.sqlSeeds[tk];
    if (seed !== undefined) sqlSeeds[tk] = seed;
    const setup = state.compareTabs[tk];
    if (setup) compareSetups[tk] = setup;
    const pipeline = state.aggregationTabs[tk];
    if (pipeline) aggregationSetups[tk] = pipeline;
    const query = state.queryBuilderTabs[tk];
    if (query) queryBuilderSetups[tk] = query;
  }
  return {
    workspace: ws,
    sqlSeeds,
    ...(Object.keys(compareSetups).length > 0 ? { compareSetups } : {}),
    ...(Object.keys(aggregationSetups).length > 0 ? { aggregationSetups } : {}),
    ...(Object.keys(queryBuilderSetups).length > 0
      ? { queryBuilderSetups }
      : {}),
    ...(relationLayouts ? { relationLayouts } : {}),
  };
}

/** Build the full snapshot to persist — every currently-open connection
 *  that actually has tabs, re-keyed from its ephemeral `conn_id` to a
 *  stable identity so it can be matched up again after a restart. Tabs
 *  still waiting for a reconnect are kept too. */
export function buildWorkspaceSnapshot(
  state: StudioStore,
): WorkspaceSnapshotV1 {
  const byConn: Record<string, SavedWorkspace> = {
    ...state.pendingWorkspaceRestore,
  };
  for (const conn of state.open) {
    const saved = savedWorkspaceOf(state, conn);
    if (saved) byConn[stableConnKey(conn)] = saved;
  }
  return { version: 1, byConn };
}

/** Debounced disk write — several store fields can change in a burst (e.g.
 *  every keystroke in a query editor updates `sqlSeeds`), and this is
 *  cheap to coalesce since only the LAST snapshot in a burst matters. */
let save_timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleWorkspaceSave(getState: () => StudioStore): void {
  if (save_timer !== null) clearTimeout(save_timer);
  save_timer = setTimeout(() => {
    save_timer = null;
    void saveWorkspaceState(buildWorkspaceSnapshot(getState()));
  }, 800);
}

/** Load the last-saved snapshot at startup. Returns `{}` for a missing,
 *  corrupt, or pre-this-feature file — never throws. */
export async function loadPendingWorkspaceRestores(): Promise<
  Record<string, SavedWorkspace>
> {
  const raw = await loadWorkspaceState().catch(() => null);
  if (!raw || typeof raw !== "object") return {};
  const snap = raw as Partial<WorkspaceSnapshotV1>;
  if (snap.version !== 1 || !snap.byConn) return {};
  return Object.fromEntries(
    Object.entries(snap.byConn).map(([k, v]) => [k, migrateDiagramTabs(v)]),
  );
}
