import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import {
  listDatabases,
  listTables,
  type ActivityEntry,
  type ConnectionInfo,
} from "@/shared/api";
import type { GridFilter } from "@/shared/components/data-grid/types";
import {
  useStudioStore,
  useWorkspace,
  tabEquals,
  tabKey,
  tabLabel,
  type StudioTab,
} from "@/shared/store";
import { Sidebar, TabBar } from "@/features/workspace";
import { ActivityDetailsTab } from "@/features/activity";
import { TablePane, MongoCollectionPane, MongoConsolePane } from "@/features/table-explorer";
import { ActivityBar } from "./activity-bar";
import { LeftPanelSlot } from "./left-panel";
import { ConnectionTabs, Landing } from "@/features/connections";

// Heavy tab contents are code-split: the SQL console pulls in CodeMirror and
// the table designer is a large editor surface, neither needed at startup.
const SqlTab = lazy(() =>
  import("@/features/sql-console").then((m) => ({ default: m.SqlTab })),
);
const NewTableTab = lazy(() =>
  import("@/features/schema-designer").then((m) => ({
    default: m.NewTableTab,
  })),
);
// Right-hand JSON inspector, only mounted when opened.
const JsonViewer = lazy(() =>
  import("@/features/inspector").then((m) => ({ default: m.JsonViewer })),
);

/** One open connection's full workspace: sidebar + tab strip + tab contents. */
export default function Workspace({
  conn,
  conns,
  active_conn_id,
  on_switch_conn,
  landing,
  on_home,
  on_tables,
  on_activity,
}: {
  conn: ConnectionInfo;
  conns: ConnectionInfo[];
  active_conn_id: string | null;
  on_switch_conn: (id: string) => void;
  landing: boolean;
  on_home: () => void;
  on_tables: () => void;
  on_activity: () => void;
}) {
  const conn_id = conn.id;

  // Revision counter so creating/dropping tables reloads sidebar + tabs.
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision((r) => r + 1), []);

  // Sidebar-only refresh: refetches the table list (used when a SQL query may
  // have created/dropped tables) WITHOUT reloading open data tabs, so queries
  // unrelated to the open table don't disturb the user's browsing state.
  const [tablesRev, setTablesRev] = useState(0);
  const bumpTables = useCallback(() => setTablesRev((r) => r + 1), []);

  // The sidebar's explicit "Reload all tables" button refreshes everything:
  // the table list AND the schema/columns/data of open table tabs.
  /** Identifies the inputs the CURRENT tables snapshot was loaded for. When
   *  it lags behind the live inputs, a (re)load is in flight — the sidebar
   *  shows its spinner + skeletons without any state flips in the effect. */
  const load_key = `${conn_id}|${revision}|${tablesRev}`;
  const [loaded_key, setLoadedKey] = useState<string | null>(null);
  const tables_reloading = loaded_key !== load_key;
  const reloadAll = useCallback(() => {
    setRevision((r) => r + 1);
    setTablesRev((r) => r + 1);
  }, []);

  const [tables, setTables] = useState<Awaited<
    ReturnType<typeof listTables>
  > | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const t = await listTables(conn_id);
        if (!cancelled) setTables(t);
      } catch {
        if (!cancelled) setTables(null);
      } finally {
        if (!cancelled) setLoadedKey(load_key);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, revision, tablesRev, load_key]);

  // Tabs state (global store, per connection — survives connection switches).
  const ws = useWorkspace(conn_id);
  const tabs = ws.tabs;
  const active = ws.active;
  const open_table = useStudioStore((s) => s.openTable);
  const open_sql = useStudioStore((s) => s.openSql);
  const open_new_table = useStudioStore((s) => s.openNewTable);
  const open_mongo_console = useStudioStore((s) => s.openMongoConsole);
  const select_tab = useStudioStore((s) => s.selectTab);
  const close_tab = useStudioStore((s) => s.closeTab);
  const move_tab = useStudioStore((s) => s.moveTab);
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStudioStore((s) => s.setSidebarOpen);
  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);
  const rightSidebarOpen = useStudioStore((s) => s.rightSidebarOpen);
  // The Activity feed replaces the tables sidebar while it's open (the shell
  // owns the toggle; this component only renders the swap).
  const activityOpen = useStudioStore((s) => s.activityOpen);
  const setActivityOpen = useStudioStore((s) => s.setActivityOpen);
  const openActivityTab = useStudioStore((s) => s.openActivityTab);
  const setActivityDetail = useStudioStore((s) => s.setActivityDetail);

  /** X on the Activity panel: collapse the whole left panel slot. */
  const close_panel = useCallback(() => {
    setActivityOpen(false);
    setSidebarOpen(false);
  }, [setActivityOpen, setSidebarOpen]);

  /** Clicking an entry in the feed opens (or updates) the single Activity
   *  tab for this connection and shows the selected command. */
  const on_activity_select = useCallback(
    (entry: ActivityEntry) => {
      setActivityDetail({ conn_id, entry });
      openActivityTab(conn_id);
    },
    [conn_id, openActivityTab, setActivityDetail],
  );
  // Tabs with unapplied work → rendered as a dot instead of the close X.
  // The three maps change identity only when their contents change, so this
  // selector is cheap.
  const dirty_keys = useStudioStore((s) => {
    const keys: string[] = [];
    for (const k of Object.keys(s.schemaEdits))
      if (s.schemaEdits[k]) keys.push(k);
    for (const k of Object.keys(s.gridBridges))
      if (s.gridBridges[k]?.pending_exists) keys.push(k);
    for (const k of Object.keys(s.newTables))
      if (s.newTables[k]?.has_draft) keys.push(k);
    for (const k of Object.keys(s.sqlTabs))
      if (s.sqlTabs[k]?.has_text) keys.push(k);
    return keys.join("\u0000");
  });

  const openTable = useCallback(
    (name: string, filters?: GridFilter[]) =>
      open_table(conn_id, name, filters),
    [open_table, conn_id],
  );
  // FK cell jump: open the referenced table in a new tab, filtered to the
  // exact record (empty value filters to NULL via the backend's eq binding).
  const openReference = useCallback(
    (refTable: string, refColumn: string, value: string | null) => {
      open_table(conn_id, refTable, [
        { id: Date.now(), column: refColumn, op: "eq", value: value ?? "" },
      ]);
    },
    [open_table, conn_id],
  );
  const openNewSql = useCallback(() => open_sql(conn_id), [open_sql, conn_id]);
  const openNewTableTab = useCallback(
    () => open_new_table(conn_id),
    [open_new_table, conn_id],
  );
  const openMongoConsoleTab = useCallback(
    () => {
      void (async () => {
        const s = useStudioStore.getState();
        let database = s.recentParams[conn_id]?.database ?? "";
        if (!database) {
          try {
            const dbs = await listDatabases(conn_id);
            database = dbs[0] ?? "";
          } catch {
            /* console still opens — `use <db>` sets context */
          }
        }
        open_mongo_console(conn_id, database);
      })();
    },
    [open_mongo_console, conn_id],
  );
  const selectTab = useCallback(
    (tab: StudioTab) => select_tab(conn_id, tab),
    [select_tab, conn_id],
  );
  // ---- Close guard -------------------------------------------------------
  // A tab is "dirty" when it holds unapplied work: schema drafts, unsaved
  // grid row edits, or an unfinished new-table definition. Closing such tabs
  // asks first (Discard / Cancel / Apply & close).
  const [confirm_close, setConfirmClose] = useState<StudioTab[] | null>(null);
  const [applying_close, setApplyingClose] = useState(false);

  const summarize_dirty = useCallback((key: string): string[] => {
    const s = useStudioStore.getState();
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
    const sq = s.sqlTabs[key];
    if (sq?.has_text) parts.push("unsaved queries");
    return parts;
  }, []);

  /** Close without asking — also drops pane modes via the store. */
  const performClose = useCallback(
    (list: StudioTab[]) => {
      for (const t of list) close_tab(conn_id, t);
    },
    [close_tab, conn_id],
  );

  /** Route every close action through here; asks when anything is dirty. */
  const requestClose = useCallback(
    (list: StudioTab[]) => {
      if (list.length === 0) return;
      if (!list.some((t) => summarize_dirty(tabKey(t)).length > 0)) {
        performClose(list);
        return;
      }
      setConfirmClose(list);
    },
    [performClose, summarize_dirty],
  );

  const applyAndClose = useCallback(async () => {
    if (!confirm_close) return;
    setApplyingClose(true);
    let aborted = false;
    try {
      const jobs: Promise<void>[] = [];
      for (const t of confirm_close) {
        const key = tabKey(t);
        const s = useStudioStore.getState();
        const se = s.schemaEdits[key];
        const gb = s.gridBridges[key];
        if (se) jobs.push(Promise.resolve(se.apply()).catch(() => {}));
        else if (gb?.pending_exists) {
          try {
            gb.apply_pending();
          } catch {
            /* surface nothing — closing proceeds either way */
          }
        }
      }
      await Promise.allSettled(jobs);
      // Applies refresh asynchronously; give drafts a moment to clear.
      const deadline = Date.now() + 6000;
      for (;;) {
        const st = useStudioStore.getState();
        const stillDirty = confirm_close.some((t) => {
          const k = tabKey(t);
          return !!st.schemaEdits[k] || !!st.gridBridges[k]?.pending_exists;
        });
        if (!stillDirty || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      // Save SQL editors — a cancelled save dialog aborts the whole close.
      for (const t of confirm_close) {
        const k = tabKey(t);
        const sq = useStudioStore.getState().sqlTabs[k];
        if (sq?.has_text) {
          const ok = await sq.save();
          if (!ok) {
            aborted = true;
            break;
          }
        }
      }
    } finally {
      setApplyingClose(false);
    }
    // A cancelled save dialog aborts the whole close: keep the dialog open.
    if (aborted || !confirm_close) return;
    const list = confirm_close;
    setConfirmClose(null);
    performClose(list);
  }, [confirm_close, performClose]);

  /** Which tabs a bulk-close action would remove (for the guard dialog). */
  const bulkTargets = useCallback(
    (mode: "all" | "left" | "right", anchor: StudioTab | null): StudioTab[] => {
      if (mode === "all") return tabs;
      const idx = anchor ? tabs.findIndex((t) => tabEquals(t, anchor)) : -1;
      if (idx < 0) return [];
      return mode === "left" ? tabs.slice(0, idx) : tabs.slice(idx + 1);
    },
    [tabs],
  );
  // ------------------------------------------------------------------------

  const active_table = active && active.kind === "table" ? active.name : null;

  const new_table_click = useCallback(() => {
    if (!landing) {
      openNewTableTab();
      setSidebarOpen(true);
    }
  }, [landing, openNewTableTab, setSidebarOpen]);

  const sql_click = useCallback(() => {
    if (!landing) {
      openNewSql();
      setSidebarOpen(true);
    }
  }, [landing, openNewSql, setSidebarOpen]);

  return (
    <div className="bg-muted/20 flex h-full w-full overflow-hidden">
      <ActivityBar
        home_active={landing}
        tables_active={!landing && !activityOpen}
        activity_active={activityOpen}
        on_home={on_home}
        on_tables={on_tables}
        on_new_table={new_table_click}
        on_sql={sql_click}
        on_activity={on_activity}
      />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Landing has its own database-kind bar; connection tabs only make
            sense once at least one database is open. */}
        {!landing && (
          <ConnectionTabs
            conns={conns}
            active_id={active_conn_id}
            on_switch={on_switch_conn}
          />
        )}
        <div className="flex min-h-0 flex-1">
          <LeftPanelSlot
            open={activityOpen || sidebarOpen}
            width={sidebarWidth}
          >
            <Sidebar
              conn_id={conn_id}
              tables={tables}
              active_table={active_table}
              on_open_table={openTable}
              show_table_tools={!landing}
              on_refresh={reloadAll}
              reloading={tables_reloading || tables === null}
              mode={activityOpen ? "activity" : "tables"}
              on_activity_close={close_panel}
              on_activity_select={on_activity_select}
            />
          </LeftPanelSlot>
          <div className="relative min-w-0 flex-1">
            {landing && (
              <div className="bg-muted/20 absolute inset-0 z-10 overflow-y-auto">
                <Landing />
              </div>
            )}
            <div className={landing ? "hidden h-full" : "h-full"}>
              {tables === null ? (
                <div className="flex flex-col gap-3 p-6">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : (
                <div className="flex h-full flex-col">
                  <TabBar
                    tabs={tabs}
                    active={active}
                    on_select={selectTab}
                    on_close={(tab) => requestClose([tab])}
                    on_reorder={(tab, to_index) =>
                      move_tab(conn_id, tab, to_index)
                    }
                    on_close_all={() => requestClose(bulkTargets("all", null))}
                    on_close_to_left={(tab) =>
                      requestClose(bulkTargets("left", tab))
                    }
                    on_close_to_right={(tab) =>
                      requestClose(bulkTargets("right", tab))
                    }
                    on_new_sql={openNewSql}
                    on_new_table={openNewTableTab}
                    on_new_mongo_console={openMongoConsoleTab}
                    dirty_keys={
                      new Set(dirty_keys.split("\u0000").filter(Boolean))
                    }
                  />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    {tabs.length === 0 ? (
                      <div className="flex h-full items-center justify-center p-6 text-center">
                        <h2 className="text-muted-foreground text-lg font-semibold">
                          Open a table from the sidebar, or press + to open a
                          SQL editor.
                        </h2>
                      </div>
                    ) : (
                      tabs.map((tab) => {
                        const is_active = tabEquals(tab, active);
                        return (
                          <div
                            key={tabKey(tab)}
                            className={is_active ? "h-full" : "hidden"}
                          >
                            {tab.kind === "table" ? (
                              <TablePane
                                conn_id={conn_id}
                                tab_key={tabKey(tab)}
                                table={tab.name}
                                revision={revision}
                                on_modified={bump}
                                initial_filters={tab.initialFilters}
                                on_open_reference={openReference}
                              />
                            ) : tab.kind === "sql" ? (
                              <Suspense fallback={<TabFallback />}>
                                <SqlTab
                                  conn_id={conn_id}
                                  tab_key={tabKey(tab)}
                                  tables={tables?.map((t) => t.name)}
                                  on_modified={bumpTables}
                                />
                              </Suspense>
                            ) : tab.kind === "mongo" ? (
                              <MongoCollectionPane
                                conn_id={conn_id}
                                tab_key={tabKey(tab)}
                                database={tab.database}
                                collection={tab.collection}
                                on_modified={bumpTables}
                              />
                            ) : tab.kind === "mongo-console" ? (
                              <Suspense fallback={<TabFallback />}>
                                <MongoConsolePane
                                  conn_id={conn_id}
                                  tab_key={tabKey(tab)}
                                  database={tab.database}
                                />
                              </Suspense>
                            ) : tab.kind === "activity" ? (
                              <ActivityDetailsTab
                                conn_id={conn_id}
                                tab_key={tabKey(tab)}
                              />
                            ) : (
                              <Suspense fallback={<TabFallback />}>
                                <NewTableTab
                                  conn_id={conn_id}
                                  tab_key={tabKey(tab)}
                                  active={is_active}
                                  on_modified={bump}
                                  on_created={openTable}
                                />
                              </Suspense>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {rightSidebarOpen && (
              <Suspense fallback={null}>
                <JsonViewer
                  conn_id={conn_id}
                  tab_key={active ? tabKey(active) : null}
                />
              </Suspense>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Close guard: tabs with unapplied work ask before they die. */}
      <Dialog
        open={confirm_close !== null}
        onOpenChange={(o) => {
          if (!o && !applying_close) setConfirmClose(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              {confirm_close?.length === 1
                ? `“${tabLabel(confirm_close[0])}” has unapplied changes.`
                : `${confirm_close?.length ?? 0} open tabs have unapplied changes.`}
            </DialogDescription>
          </DialogHeader>
          <ul className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3 text-sm">
            {confirm_close?.map((t) => {
              const parts = summarize_dirty(tabKey(t));
              if (parts.length === 0) return null;
              return (
                <li
                  key={tabKey(t)}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="min-w-0 truncate font-medium">
                    {tabLabel(t)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {parts.join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={applying_close}
              onClick={() => setConfirmClose(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={applying_close}
              onClick={() => {
                const list = confirm_close;
                setConfirmClose(null);
                if (list) performClose(list);
              }}
            >
              {confirm_close?.some(
                (t) => useStudioStore.getState().sqlTabs[tabKey(t)]?.has_text,
              )
                ? "Don't save"
                : "Discard changes"}
            </Button>
            <Button
              disabled={applying_close}
              onClick={() => void applyAndClose()}
            >
              {applying_close ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Applying…
                </>
              ) : (
                (() => {
                  const hasSql = confirm_close?.some(
                    (t) =>
                      useStudioStore.getState().sqlTabs[tabKey(t)]?.has_text,
                  );
                  const hasApply = confirm_close?.some((t) => {
                    const k = tabKey(t);
                    const s = useStudioStore.getState();
                    return (
                      !!s.schemaEdits[k] || !!s.gridBridges[k]?.pending_exists
                    );
                  });
                  if (hasSql && hasApply) return "Apply, save & close";
                  return hasSql ? "Save & close" : "Apply & close";
                })()
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabFallback() {
  return (
    <div className="flex h-full flex-col gap-3 p-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
