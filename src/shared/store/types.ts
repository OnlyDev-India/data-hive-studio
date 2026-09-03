import type {
  ActivityEntry,
  ConnectionInfo,
  ExportPayload,
  QueryOp,
} from "../api/types";
import type { GridFilter } from "@/shared/components/data-grid/types";
import type { StudioTab } from "./tab-utils";
import type { PendingChange } from "../components/data-grid/grid-context";
import type { PaneNode } from "./pane-layout";

/** Which top-level screen fills the workspace area. */
export type StudioView = "home" | "workspace" | "admin";

/** Handle a grid exposes to the status bar so it can show tab info and drive
 * the active table's limit/pagination/actions from the bottom bar. */
export interface GridBridge {
  rows: number;
  total: number;
  /** True while the page query (count + rows) is in flight — the action bar
   *  spins/disables Refresh and the grid blocks edits. */
  loading: boolean;
  total_pages: number;
  page: number;
  set_page: (p: number) => void;
  page_size: number;
  set_page_size: (n: number) => void;
  has_full_row: boolean;
  selected_count: number;
  editable: boolean;
  elapsed_ms: number | null;
  delete_rows: () => void;
  /** True while not-yet-inserted "pending" rows are being drafted. */
  pending_exists: boolean;
  /** Number of pending rows currently drafted. */
  pending_count: number;
  /** Begin drafting a new row: pins a blank pending row to the top of the grid. */
  start_pending: () => void;
  /** Commit all drafted pending rows as real records. `keepIds` limits which
   *  staged changes are applied (see {@link PendingChange}). */
  apply_pending: (keepIds?: Set<string>) => void;
  /** Discard all drafted pending rows. */
  cancel_pending: () => void;
  /** Render every pending change (insert drafts, cell edits, row deletions)
   *  as runnable SQL statements, or null when nothing is staged. */
  get_pending_sql: () => string | null;
  /** Structured list of every buffered change for the apply diff dialog. */
  get_pending_changes: () => PendingChange[];
  refresh: () => void;
  /** Snapshot of the loaded result for exports (null when nothing loaded).
   *  Reflects the last fetched page as stored in the database — buffered,
   *  not-yet-applied edits are excluded. */
  get_export: () => ExportPayload | null;
  /** Structured SELECT matching the grid's current filters and sort, WITHOUT
   *  pagination — run it to fetch every matching row (used by exports). */
  get_filtered_op: () => Extract<QueryOp, { kind: "select" }>;
}

/** A single data-grid row captured for the right-side JSON viewer. */
export interface JsonRow {
  conn_id: string;
  table: string;
  row_number: number;
  data: Record<string, unknown>;
  /** "mongo" rows render/parse as BSON source (ObjectId, ISODate, …); anything
   *  else renders/parses as plain JSON (Postgres stores plain values). */
  kind?: "mongo" | "sql";
  /** Schema `data_type` per column, so the mongo editor can render ObjectId /
   *  ISODate constructors for columns that are really those BSON types. */
  col_types?: Record<string, string>;
  /** Write one changed top-level field back into the owning grid's buffered
   *  edits (so the toolbar Apply persists it). Absent ⇒ row is read-only. */
  on_edit?: (col: string, value: string | null) => void;
}

/** Per-connection tab/workspace state. */
export interface WorkspaceTabs {
  tabs: StudioTab[];
  /** The active tab of the FOCUSED pane (see `focusedPaneId`) — kept in
   *  sync by every pane-aware mutator. With no splits (the common case)
   *  this behaves exactly like a single global "active tab". */
  active: StudioTab | null;
  nextSqlId: number;
  nextNewTableId: number;
  nextTableId: number;
  nextMongoTabId: number;
  /** Data/schema mode per table-tab instance, keyed by the tab's unique key. */
  paneModes: Record<string, "data" | "schema">;
  /** Split-view pane tree. A never-split workspace is a single leaf holding
   *  every open tab — see `pane-layout.ts` for the shape/invariants. */
  layout: PaneNode;
  /** Id of the leaf pane last interacted with (clicked into, selected a tab
   *  in, etc). New tabs open into this pane; the action bar reads `active`
   *  (this pane's active tab) to decide what it drives. */
  focusedPaneId: string;
}

/** Live handle from an open Schema tab with unsaved DDL drafts; the status
 *  bar renders Apply/Discard from it (mirrors GridBridge for data edits). */
export interface SchemaEditHandle {
  /** Number of DDL statements the next Apply would run. */
  count: number;
  /** True while an Apply is in flight — the status bar disables the buttons
   *  and shows a spinner on Apply. */
  busy: boolean;
  /** Runs the batch; resolves when the transaction finished (success or
   *  rolled-back failure), so close-guards can await it. */
  apply: () => void | Promise<void>;
  discard: () => void;
}

/** Registered while a table pane's Schema editor is open; lets the status bar
 *  trigger the pane-level Refresh and the destructive Drop-table flow. */
export interface SchemaPaneHandle {
  /** True while an Apply is in flight — pane-level tools are disabled so a
   *  refresh/drop cannot race the running batch. */
  busy: boolean;
  /** Reload the schema from the database (discards nothing — drafts are
   *  reset only when the reloaded schema differs). */
  refresh: () => void;
  /** Ask the pane to open its confirm dialog for dropping the table. */
  drop: () => void;
}

/** Registered by every SQL editor tab while mounted. `save` writes the
 *  queries to a file the user picks, resolving false when cancelled;
 *  `run_all`/`run_target` drive the status bar's run controls. Generic —
 *  every SQL-shaped connection registers this much, independent of which
 *  database kind it targets. */
export interface SqlTabHandleBase {
  /** True whenever the editor has any non-empty text — drives Run All's
   *  enabled state. NOT the same as "unsaved" — see `is_dirty`. */
  has_text: boolean;
  /** True when the editor's text differs from what was last saved (or has
   *  never been saved and has text) — drives the tab-strip dirty dot, the
   *  close-confirmation prompt, and its button wording. Stays false right
   *  after a successful save even though `has_text` may still be true. */
  is_dirty: boolean;
  save: () => Promise<boolean>;
  /** Run all queries in the editor. */
  run_all?: () => void;
  /** Whether a target (selection) can be run. */
  can_run_target?: boolean;
  /** Run the selected query target. */
  run_target?: () => void;
  /** Summary of the currently active result tab, for the action bar's
   *  rows/time display — SQL query results have no GridBridge (they're not
   *  paginated/editable), so this is how that info reaches the action bar
   *  instead. Null when no result tab is active, it's still running, or it
   *  errored (nothing meaningful to show). */
  result?: { rows: number; is_select: boolean; elapsed_ms: number } | null;
  /** Basename of the file this editor was last saved to, or null if it's
   *  never been saved — the tab strip shows this instead of the generic
   *  "SQL"/"NoSQL console" label once set. */
  file_name?: string | null;
}

/** Extra fields table-explorer's Mongo console pane registers on top of the
 *  base handle — collection introspection/switching has no SQL equivalent,
 *  so it's kept as an addition rather than folded into the generic shape. */
export interface MongoSqlTabExtras {
  /** List of collections in the current database. */
  mongo_collections?: string[];
  /** Currently selected collection. */
  mongo_collection?: string;
  /** Change the selected collection. */
  set_mongo_collection?: (c: string) => void;
}

export type SqlTabHandle = SqlTabHandleBase & MongoSqlTabExtras;

/** One entry in the action-bar notification popover. */
export interface StudioNotification {
  id: string;
  kind: "success" | "error" | "info";
  title: string;
  /** Optional longer body (SQL, error text…), truncated in the list with the
   *  full text available via tooltip. */
  detail?: string;
  /** Epoch ms — used to sort and to display a time. */
  at: number;
  /** Whether this notification has been seen by the user. */
  read: boolean;
  /** Optional action button label (e.g. "Retry", "View details"). */
  actionLabel?: string;
  /** Callback invoked when the action button is clicked. Not serialized. */
  actionFn?: () => void;
  /** Longer description shown in a detail dialog when the user clicks "View". */
  description?: string;
}

// Connection parameters for one saved connection (PostgreSQL or MongoDB)
// persisted in localStorage so double-click reconnect works across restarts.
export interface SavedConnParams {
  /** Optional display name (saved/pinned connections). */
  name?: string;
  /** Which database kind this connection reopens. */
  kind: "postgres" | "mongodb" | "sqlite";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** PostgreSQL only: SSL mode. */
  ssl_mode?: string;
  /** MongoDB only: auth source database (default "admin"). */
  auth_db?: string;
  /** MongoDB only: use mongodb+srv:// (DNS seedlist) instead of mongodb://. */
  srv?: boolean;
  /** MongoDB only: require TLS on a plain mongodb:// connection. */
  tls?: boolean;
  /** SQLite only: real file path prefilled into the connect form. */
  source_path?: string | null;
}

/** What the landing form is editing (when prefill carries an edit target). */
export type LandingEditTarget =
  | { source: "server"; profileId: string; remoteId: string; name: string }
  | { source: "local"; oldName: string; name: string };

export interface StudioStore {
  // Connections
  open: ConnectionInfo[];
  activeId: string | null;
  recent: ConnectionInfo[];
  openConn: (conn: ConnectionInfo) => void;
  setActive: (id: string) => void;
  closeConn: (id: string) => void;
  updateConn: (id: string, patch: Partial<ConnectionInfo>) => void;

  // View
  view: StudioView;
  setView: (view: StudioView) => void;

  // Sidebar chrome
  sidebarOpen: boolean;
  sidebarWidth: number;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (px: number) => void;
  /** Which content the left panel slot last showed (tables sidebar or the
   *  Activity feed) — restored when `toggleLeftPanel` reopens a closed slot. */
  sidebarLastMode: "tables" | "activity";
  /** VSCode-style "toggle sidebar visibility": closes the whole left panel
   *  slot regardless of whether it's currently showing the tables sidebar or
   *  the Activity feed, and reopens it to whichever was last visible. */
  toggleLeftPanel: () => void;

  // Right sidebar (JSON row viewer)
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  toggleRightSidebar: () => void;
  setRightSidebarOpen: (open: boolean) => void;
  setRightSidebarWidth: (px: number) => void;
  jsonRows: Record<string, JsonRow | null>;
  setJsonRow: (scope: string, row: JsonRow | null) => void;

  // Grid bridges (active table grid -> status bar controls)
  gridBridges: Record<string, GridBridge | null>;
  setGridBridge: (key: string, bridge: GridBridge | null) => void;
  clearGridBridge: (key: string) => void;

  // Schema edit handles (active schema tab -> status bar Apply/Discard)
  schemaEdits: Record<string, SchemaEditHandle | null>;
  setSchemaEdit: (key: string, handle: SchemaEditHandle) => void;
  clearSchemaEdit: (key: string) => void;

  // Schema pane handles (open schema editor -> status bar Refresh/Drop table)
  schemaPanes: Record<string, SchemaPaneHandle | null>;
  setSchemaPane: (key: string, handle: SchemaPaneHandle) => void;
  clearSchemaPane: (key: string) => void;

  /** Registered by each New-table tab under its tab key; the action bar
   *  shows the Create button of whichever new-table tab is ACTIVE, enabled
   *  only while its generated SQL is valid. */
  newTables: Record<
    string,
    {
      create: () => void;
      creating: boolean;
      valid: boolean;
      has_draft: boolean;
    }
  >;
  setNewTable: (
    key: string,
    handle: {
      create: () => void;
      creating: boolean;
      valid: boolean;
      has_draft: boolean;
    },
  ) => void;
  clearNewTable: (key: string) => void;

  /** Registered by every SQL editor tab while mounted. */
  sqlTabs: Record<string, SqlTabHandle>;
  setSqlTab: (key: string, handle: SqlTabHandle) => void;
  clearSqlTab: (key: string) => void;

  /** Initial text handed to a freshly opened SQL/Mongo-console tab, keyed by
   *  its tab key. openSql/openMongoConsole(..., text) stashes it here; the
   *  tab reads it once on mount and closeTab deletes the entry. */
  sqlSeeds: Record<string, string>;
  /** Set alongside sqlSeeds ONLY when the seed came from an actual file on
   *  disk (openFileTab), never from generated content (e.g. action-bar's
   *  "open pending edits as SQL"). When present, the tab treats the seed as
   *  already-saved (clean baseline + this filename) instead of unsaved new
   *  work — same lifecycle as sqlSeeds (set once, deleted by closeTab). */
  seedFileNames: Record<string, string>;

  /** Generic notification center (action-bar bell). Any feature can push a
   *  notification — e.g. applied schema changes, export results, failed
   *  operations. Newest first, capped, session-only. */
  notifications: StudioNotification[];
  pushNotification: (n: {
    kind: StudioNotification["kind"];
    title: string;
    detail?: string;
    actionLabel?: string;
    actionFn?: () => void;
    description?: string;
  }) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  unreadCount: () => number;

  /** Floating toast queue — items appear near the bell icon, auto-dismiss
   *  after a short delay, and are removed from the queue. Separate from the
   *  persisted notification list (bell popover). */
  toastQueue: StudioNotification[];
  dismissToast: (id: string) => void;

  /** Live feed of backend commands (Activity sidebar). Fed by the
   *  `activity://entry` Tauri event; newest first, capped, session-only. */
  activityOpen: boolean;
  toggleActivityOpen: () => void;
  setActivityOpen: (open: boolean) => void;
  activity: ActivityEntry[];
  pushActivity: (entry: ActivityEntry) => void;
  /** Replace the whole list (hydration from get_activity on startup). */
  setActivity: (entries: ActivityEntry[]) => void;
  clearActivityEntries: () => void;

  /** The entry shown in the (singleton) Activity details tab. Tagged with its
   *  connection so a tab on connection A never shows B's entry. */
  activityDetail: { conn_id: string; entry: ActivityEntry } | null;
  setActivityDetail: (
    d: { conn_id: string; entry: ActivityEntry } | null,
  ) => void;

  /** Saved connection params per connection id (recents), includes `kind`. */
  recentParams: Record<string, SavedConnParams>;
  pushRecentParams: (connId: string, params: SavedConnParams) => void;
  /** Locally saved connections keyed by display name ('saved.local').
   *  Each entry carries `kind` ("postgres" | "mongodb") so it reopens correctly. */
  savedLocal: Record<string, SavedConnParams>;
  /** Save a local connection (any kind). */
  saveLocal: (name: string, params: SavedConnParams) => void;
  /** Rename/update a saved local connection. */
  updateSavedLocal: (
    oldName: string,
    name: string,
    params: SavedConnParams,
  ) => void;
  /** Delete a saved local connection. */
  deleteSavedLocal: (name: string) => void;
  /** Pinned ids across sources: 'local:<name>' or 'srv:<profile>:<conn>' ('pg.pins'). */
  pins: string[];
  togglePin: (id: string) => void;
  /** Landing-page prefill request: sidebar click hands connection details to the
   *  connect form. `kind` routes to the right tab; `n` increments so repeat
   *  requests re-trigger; `connect` additionally starts connecting right after
   *  the fields are filled. `edit` puts the form in edit mode — Save updates
   *  that connection (server-shared or local) instead of creating a new one. */
  landingPrefill: {
    kind: "postgres" | "mongodb" | "sqlite";
    params: SavedConnParams;
    n: number;
    connect: boolean;
    edit?: LandingEditTarget;
  } | null;
  requestLandingPrefill: (
    kind: "postgres" | "mongodb" | "sqlite",
    params: SavedConnParams,
    connect?: boolean,
    edit?: LandingEditTarget,
  ) => void;
  /** Consume the prefill after applying it — prevents replay on remount. */
  clearLandingPrefill: () => void;
  /** Global Postgres connect-in-flight flag (survives page switches). */
  pgConnecting: boolean;
  setPgConnecting: (v: boolean) => void;
  /** Global MongoDB connect-in-flight flag (survives page switches). */
  mongoConnecting: boolean;
  setMongoConnecting: (v: boolean) => void;

  /** Command palette open state. */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // ---- Split-view drag-to-split (ephemeral, session/UI-only — never
  // persisted; see partialize in store.ts) --------------------------------
  /** The tab currently being dragged, if any. `sourcePaneId` is where the
   *  drag started — informational only; the store always looks up a tab's
   *  CURRENT owner pane fresh on every move/drop. */
  dragTab: { connId: string; sourcePaneId: string; tab: StudioTab } | null;
  setDragTab: (v: StudioStore["dragTab"]) => void;
  /** Live cursor position while dragging, for the floating ghost chip. */
  dragPointer: { x: number; y: number } | null;
  setDragPointer: (v: StudioStore["dragPointer"]) => void;
  /** Where a drag is currently hovering: a specific pane, and which edge
   *  (split) or "center" (plain move, no split) it would land on if
   *  dropped now. Drives the pane edge/center highlight overlay. */
  dropTarget: {
    paneId: string;
    edge: "left" | "right" | "top" | "bottom" | "center";
  } | null;
  setDropTarget: (v: StudioStore["dropTarget"]) => void;

  // Per-connection workspaces (tabs)
  workspaces: Record<string, WorkspaceTabs>;
  openTable: (
    connId: string,
    name: string,
    initialFilters?: GridFilter[],
  ) => void;
  openStructure: (connId: string, name: string) => void;
  /** `seedFileName`, when given, marks `seedText` as loaded from that real
   *  file (openFileTab) — the tab starts clean (not dirty) and shows this as
   *  its name, instead of treating the seed as unsaved new work. */
  openSql: (connId: string, seedText?: string, seedFileName?: string) => void;
  openNewTable: (connId: string) => void;
  /** Open (or focus — it is a singleton per connection) the Activity tab. */
  openActivityTab: (connId: string) => void;
  /** Open a MongoDB collection tab (data view). */
  openMongo: (connId: string, database: string, collection: string) => void;
  /** Open a MongoDB console tab for the given connection & database.
   *  `seedText`, when given, becomes the new console's initial script —
   *  mirrors `openSql`'s seed mechanism (e.g. opening a picked .js file).
   *  `seedFileName` — see `openSql`'s doc. */
  openMongoConsole: (
    connId: string,
    database: string,
    seedText?: string,
    seedFileName?: string,
  ) => void;
  /** Select `tab` within pane `paneId`, and focus that pane. */
  selectTab: (connId: string, paneId: string, tab: StudioTab) => void;
  closeTab: (connId: string, tab: StudioTab) => void;
  /** Move `tab` so it ends up at index `toIndex` of pane `toPaneId`'s strip
   *  — same-pane reorder, or a cross-pane relocate (tab moves OUT of its
   *  current pane, never mirrored). */
  movePaneTab: (
    connId: string,
    tab: StudioTab,
    toPaneId: string,
    toIndex: number,
  ) => void;
  /** Split pane `targetPaneId` on `edge`, moving `tab` (out of wherever it
   *  currently lives) into a brand-new leaf on that side. */
  splitPane: (
    connId: string,
    targetPaneId: string,
    tab: StudioTab,
    edge: "left" | "right" | "top" | "bottom",
  ) => void;
  /** Mark `paneId` as the focused pane (mirrors its active tab into
   *  `active`). Fired on click/select-tab/other interaction inside a pane. */
  focusPane: (connId: string, paneId: string) => void;
  /** Persist a completed resize of split `splitId`'s children (percentages,
   *  same order as its children). Session-only, like the rest of `tabs`. */
  resizeSplit: (connId: string, splitId: string, sizes: number[]) => void;
  closeAllTabs: (connId: string) => void;
  closeToLeft: (connId: string, tab: StudioTab) => void;
  closeToRight: (connId: string, tab: StudioTab) => void;
  setPaneMode: (
    connId: string,
    tabKey: string,
    mode: "data" | "schema",
  ) => void;

  // Team servers (dh-server profiles)
  /** One entry per CONNECTED server profile; keyed by profile id. */
  serverSessions: Record<
    string,
    {
      profile: { id: string; name: string; url: string };
      me: { device_id: string; is_admin: boolean };
      /** Granted connections as namespaced ids (`srv:<profile>:<conn>`). */
      connIds: string[];
      /** Full shared-connection entries incl. this device's access level. */
      connections: {
        id: string;
        name: string;
        kind: "postgres" | "mongodb";
        host: string;
        port: number;
        user: string;
        database: string;
        ssl_mode?: string | null;
        /** MongoDB only. */
        auth_db?: string;
        srv?: boolean;
        tls?: boolean;
        data_access: "readonly" | "readwrite";
        can_edit: boolean;
        can_delete: boolean;
      }[];
    }
  >;
  serverBusy: boolean;
  connectServer: (profileId: string) => Promise<void>;
  disconnectServer: (profileId: string) => Promise<void>;
  /** Re-fetch every connected server's shared-connection catalog (keeps
   *  open tabs intact). */
  refreshServers: () => Promise<void>;
  /** Delete a shared connection on this profile and drop its local entry. */
  deleteServerConnection: (
    profileId: string,
    connId: string,
    srvId: string,
  ) => Promise<void>;
}
