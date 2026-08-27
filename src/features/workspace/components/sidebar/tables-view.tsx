import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChevronRight,
  Copy,
  CopyPlus,
  Eye,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Table as TableIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  createPgDatabase,
  createPgSchema,
  dropPgDatabase,
  dropPgSchema,
  duplicateTable,
  executeOp,
  catalogOverview,
  quoteIdent,
  refreshMatview,
  runSql,
  setActiveSchema,
  connectPostgres,
} from "@/shared/api";
import { useStudioStore, type StudioStore } from "@/shared/store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

function uniqueCopyName(name: string, tables: { name: string }[]): string {
  const used = new Set(tables.map((t) => t.name));
  if (!used.has(`${name}_copy`)) return `${name}_copy`;
  let i = 2;
  while (used.has(`${name}_copy_${i}`)) i += 1;
  return `${name}_copy_${i}`;
}

/** Database browser: schema/database selectors (PG), searchable table list
 *  with context menus, server-object browsers and their dialogs. */
export function TablesBrowser({
  conn_id,
  tables,
  active_table,
  on_open_table,
  on_refresh,
  reloading = false,
  search_value,
  on_search_change,
}: {
  conn_id: string;
  tables: { name: string; kind: string }[] | null;
  active_table: string | null;
  on_open_table: (name: string) => void;
  on_refresh: () => void;
  reloading?: boolean;
  search_value: string;
  on_search_change: (v: string) => void;
}) {
  const search = search_value;
  const [selected_name, setSelectedName] = useState<string | null>(null);
  const list_ref = useRef<HTMLDivElement>(null);
  const [confirm_drop, setConfirmDrop] = useState<{
    name: string;
    kind: string;
  } | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dropdown_error, setDropdownError] = useState<string | null>(null);
  const [confirm_duplicate, setConfirmDuplicate] = useState<{
    name: string;
  } | null>(null);
  const [dupe_name, setDupeName] = useState("");
  const [dupe_submitting, setDupeSubmitting] = useState(false);
  const [dupe_error, setDupeError] = useState<string | null>(null);

  const store_open_table = useStudioStore((s) => s.openTable);
  const open_structure = useStudioStore((s) => s.openStructure);
  const push_notification = useStudioStore((s) => s.pushNotification);

  // ---- Postgres database / schema switcher -------------------------------
  const conn_kind = useStudioStore(
    (s: StudioStore) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const is_pg = conn_kind === "postgres";
  const [pg_schemas, setPgSchemas] = useState<string[] | null>(null);
  const [pg_active_schema, setPgActiveSchema] = useState("public");
  const [pg_databases, setPgDatabases] = useState<string[]>([]);
  const [switching_db, setSwitchingDb] = useState(false);
  /** Bumped after DDL so the schema/database lists refetch. */
  const [ddl_rev, setDdlRev] = useState(0);
  const [ddl_name, setDdlName] = useState("");

  const recents_db = useStudioStore((s) => s.recentParams[conn_id]?.database);
  const conn_name = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.name,
  );
  const pg_current_db = recents_db ?? conn_name ?? "";

  useEffect(() => {
    if (!is_pg) return;
    let cancelled = false;
    void (async () => {
      try {
        const overview = await catalogOverview(conn_id);
        if (cancelled) return;
        setPgSchemas(overview.schemas);
        setPgDatabases(overview.databases);
        setPgActiveSchema(overview.active_schema);
      } catch {
        if (!cancelled) setPgSchemas(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, is_pg, ddl_rev]);

  // ---- Create/drop database & schema (Postgres DDL dialogs) ----
  const [ddl_dialog, setDdlDialog] = useState<null | {
    kind: "db-create" | "db-drop" | "schema-create" | "schema-drop";
    name: string;
  }>(null);
  const [ddl_cascade, setDdlCascade] = useState(false);
  const [ddl_busy, setDdlBusy] = useState(false);
  const [ddl_error, setDdlError] = useState<string | null>(null);

  const open_ddl = (
    kind: "db-create" | "db-drop" | "schema-create" | "schema-drop",
    name = "",
  ) => {
    setDdlError(null);
    setDdlCascade(false);
    setDdlDialog({ kind, name });
  };

  const run_ddl = async () => {
    if (!ddl_dialog || ddl_busy) return;
    setDdlBusy(true);
    setDdlError(null);
    try {
      const name =
        ddl_dialog.kind === "db-drop" || ddl_dialog.kind === "schema-drop"
          ? ddl_dialog.name
          : ddl_name.trim();
      if (!name) throw new Error("Name must not be empty.");
      switch (ddl_dialog.kind) {
        case "db-create":
          await createPgDatabase(conn_id, name);
          break;
        case "db-drop":
          await dropPgDatabase(conn_id, name);
          break;
        case "schema-create":
          await createPgSchema(conn_id, name);
          break;
        case "schema-drop":
          await dropPgSchema(conn_id, name, ddl_cascade);
          if (pg_active_schema === name) setPgActiveSchema("public");
          break;
      }
      setDdlDialog(null);
      setDdlRev((r) => r + 1);
      if (
        ddl_dialog.kind === "schema-create" ||
        ddl_dialog.kind === "schema-drop"
      ) {
        on_refresh();
      }
    } catch (e) {
      setDdlError(String(e));
    } finally {
      setDdlBusy(false);
    }
  };

  const change_schema = async (schema: string) => {
    if (schema === pg_active_schema) return;
    try {
      await setActiveSchema(conn_id, schema);
      setPgActiveSchema(schema);
      on_refresh();
    } catch (e) {
      push_notification({
        kind: "error",
        title: "Schema switch failed",
        detail: String(e),
      });
    }
  };

  const change_database = async (db: string) => {
    if (!db || switching_db) return;
    const params = useStudioStore.getState().recentParams[conn_id];
    if (!params || db === params.database) return;
    setSwitchingDb(true);
    try {
      const fresh = await connectPostgres({ ...params, database: db });
      useStudioStore
        .getState()
        .pushRecentParams(fresh.id, { ...params, database: db });
      useStudioStore.getState().openConn(fresh);
    } catch (e) {
      push_notification({
        kind: "error",
        title: `Could not open “${db}”`,
        detail: String(e),
      });
    } finally {
      setSwitchingDb(false);
    }
  };

  // ---- Server-object browsers (sequences/extensions/functions/roles) ----
  const [srv_open, setSrvOpen] = useState<string | null>(null);
  const [srv_data, setSrvData] = useState<
    Record<
      string,
      { cols: string[]; rows: (string | null)[][] } | "loading" | null
    >
  >({});
  const esc_lit = (v: string) => v.replace(/'/g, "''");
  const SRV_QUERIES: Record<string, string> = {
    Sequences: `SELECT sequencename AS name, COALESCE(last_value::text,'-') AS last FROM pg_sequences WHERE schemaname='${esc_lit(pg_active_schema)}' ORDER BY 1`,
    Extensions: `SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY 1`,
    Functions: `SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS signature, l.lanname AS language FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.prokind = 'f' AND l.lanname NOT IN ('c','internal') ORDER BY 1 LIMIT 300`,
    Roles: `SELECT rolname AS name, rolsuper::text AS superuser, rolcanlogin::text AS login FROM pg_roles ORDER BY 1`,
  };
  const toggle_srv = (kind: string) => {
    if (srv_open === kind) {
      setSrvOpen(null);
      return;
    }
    setSrvOpen(kind);
    if (!srv_data[kind] || srv_data[kind] === null) {
      setSrvData((prev) => ({ ...prev, [kind]: "loading" }));
      runSql(conn_id, SRV_QUERIES[kind])
        .then((res) =>
          setSrvData((prev) => ({
            ...prev,
            [kind]: { cols: res.columns, rows: res.rows },
          })),
        )
        .catch(() => setSrvData((prev) => ({ ...prev, [kind]: null })));
    }
  };

  // ---- Grants viewer for a table/view/matview ----
  const [grants_for, setGrantsFor] = useState<string | null>(null);
  const [grants_rows, setGrantsRows] = useState<(string | null)[][] | null>(
    null,
  );

  useEffect(() => {
    if (!grants_for || !is_pg) return;
    let cancelled = false;
    runSql(
      conn_id,
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='${esc_lit(pg_active_schema)}' AND table_name='${esc_lit(grants_for)}' ORDER BY 1, 2`,
    )
      .then((res) => {
        if (!cancelled) setGrantsRows(res.rows);
      })
      .catch(() => {
        if (!cancelled) setGrantsRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [grants_for, conn_id, is_pg, pg_active_schema]);

  // ---- List filtering + keyboard navigation ------------------------------
  const loading = tables === null || reloading;
  const pg_loading = is_pg && pg_schemas === null;

  const filtered_tables = useMemo(() => {
    if (!tables) return [];
    const q = search.toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, search]);

  const [prev_active, setPrevActive] = useState(active_table);
  if (prev_active !== active_table) {
    setPrevActive(active_table);
    setSelectedName(active_table);
  }

  const [prev_search, setPrevSearch] = useState(search);
  if (prev_search !== search) {
    setPrevSearch(search);
    const q = search.toLowerCase();
    if (q) {
      setSelectedName(
        tables?.find((t) => t.name.toLowerCase().includes(q))?.name ?? null,
      );
    }
  }

  useEffect(() => {
    if (!selected_name) return;
    list_ref.current
      ?.querySelector(`[data-table="${CSS.escape(selected_name)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected_name]);

  const move_selection = useCallback(
    (delta: number) => {
      if (!tables) return;
      if (filtered_tables.length === 0) return;
      const idx = filtered_tables.findIndex((t) => t.name === selected_name);
      const next =
        idx < 0
          ? 0
          : Math.min(filtered_tables.length - 1, Math.max(0, idx + delta));
      setSelectedName(filtered_tables[next].name);
    },
    [tables, filtered_tables, selected_name],
  );

  const open_selected = useCallback(() => {
    const name = selected_name ?? filtered_tables[0]?.name;
    if (name) on_open_table(name);
  }, [filtered_tables, selected_name, on_open_table]);

  const handle_nav_keys = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move_selection(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move_selection(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        open_selected();
      }
    },
    [move_selection, open_selected],
  );

  const do_drop = async () => {
    if (!confirm_drop || dropping) return;
    setDropping(true);
    setDropdownError(null);
    try {
      if (confirm_drop.kind === "table") {
        await executeOp(conn_id, {
          kind: "drop_table",
          table: confirm_drop.name,
        });
      } else {
        await runSql(
          conn_id,
          `DROP VIEW IF EXISTS ${quoteIdent(confirm_drop.name)}`,
        );
      }
      setConfirmDrop(null);
      on_refresh();
    } catch (e) {
      setDropdownError(String(e));
    } finally {
      setDropping(false);
    }
  };

  const copy_name = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // Clipboard unavailable in this webview; ignore.
    }
  };

  const duplicate_table = async () => {
    if (!confirm_duplicate || dupe_submitting) return;
    const target = dupe_name.trim();
    if (!target) {
      setDupeError("Enter a name for the duplicate table.");
      return;
    }
    const taken = (tables ?? []).some(
      (t) => t.name.toLowerCase() === target.toLowerCase(),
    );
    if (taken) {
      setDupeError(`A table named “${target}” already exists.`);
      return;
    }
    setDupeSubmitting(true);
    setDupeError(null);
    try {
      await duplicateTable(conn_id, confirm_duplicate.name, target);
      setConfirmDuplicate(null);
      on_refresh();
      store_open_table(conn_id, target);
    } catch (e) {
      setDupeError(String(e));
    } finally {
      setDupeSubmitting(false);
    }
  };

  const ask_duplicate = (t: { name: string }) => {
    setDupeError(null);
    setDupeName(uniqueCopyName(t.name, tables ?? []));
    setConfirmDuplicate(t);
  };

  return (
    <>
      {/* Selector strip is ALWAYS visible on PG — disabled (with placeholders)
          while the catalog overview loads. */}
      {is_pg && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Select
              value={pg_current_db || null}
              onValueChange={(v) => void change_database(v as string)}
              disabled={switching_db || pg_loading}
            >
              <SelectTrigger
                size="sm"
                aria-label="Database"
                title="Opens this database as a new connection"
                className="h-7 min-w-0 flex-1 px-2 text-xs"
              >
                <SelectValue>
                  {pg_loading ? (
                    <span className="text-muted-foreground">database…</span>
                  ) : (
                    pg_current_db || (
                      <span className="text-muted-foreground">database…</span>
                    )
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pg_databases.map((d) => (
                  <SelectItem key={d} value={d} className="text-xs">
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="iconXs"
              variant="ghost"
              aria-label="New database"
              title="Create database on this server"
              className="size-7 shrink-0"
              disabled={pg_loading}
              onClick={() => {
                setDdlName("");
                open_ddl("db-create");
              }}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Select
              value={pg_loading ? null : pg_active_schema || null}
              onValueChange={(v) => void change_schema(v as string)}
              disabled={switching_db || pg_loading}
            >
              <SelectTrigger
                size="sm"
                aria-label="Schema"
                className="h-7 min-w-0 flex-1 px-2 text-xs"
              >
                <SelectValue>
                  {pg_loading ? (
                    <span className="text-muted-foreground">schema…</span>
                  ) : (
                    pg_active_schema || (
                      <span className="text-muted-foreground">schema…</span>
                    )
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(pg_schemas ?? []).map((sc) => (
                  <SelectItem key={sc} value={sc} className="text-xs">
                    {sc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="iconXs"
              variant="ghost"
              aria-label="New schema"
              title="Create schema"
              className="size-7 shrink-0"
              disabled={pg_loading}
              onClick={() => {
                setDdlName("");
                open_ddl("schema-create");
              }}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              size="iconXs"
              variant="ghost"
              aria-label="Drop schema"
              title={`Drop a schema (active: ${pg_active_schema})`}
              disabled={pg_loading || pg_active_schema === "public"}
              className="size-7 shrink-0"
              onClick={() => open_ddl("schema-drop", pg_active_schema)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            className="h-7 pr-2 pl-7 text-xs"
            placeholder="Search tables…"
            value={search}
            disabled={loading}
            onChange={(e) => on_search_change(e.target.value)}
            onKeyDown={handle_nav_keys}
          />
        </div>
        <Button
          size="iconSm"
          variant="outline"
          aria-label={reloading ? "Refreshing tables" : "Refresh tables"}
          title="Reload all tables"
          className="size-7"
          disabled={reloading}
          onClick={on_refresh}
        >
          <RefreshCw className={cn("size-3.5", reloading && "animate-spin")} />
        </Button>
      </div>

      <div
        ref={list_ref}
        tabIndex={0}
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto outline-none"
        onKeyDown={handle_nav_keys}
      >
        {loading ? (
          <div className="flex flex-col gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-muted/60 h-7 w-full animate-pulse rounded-md"
              />
            ))}
          </div>
        ) : filtered_tables.length === 0 ? (
          <p className="text-muted-foreground px-2 py-4 text-center text-sm">
            No tables found.
          </p>
        ) : (
          filtered_tables.map((t) => (
            <TableListItem
              key={t.name}
              name={t.name}
              kind={t.kind}
              is_selected={t.name === (selected_name ?? active_table)}
              disabled={dupe_submitting}
              on_select={() => {
                setSelectedName(t.name);
                // Focus the list so arrow keys / Enter work right away
                // (WebKit does not focus buttons on click).
                list_ref.current?.focus();
              }}
              on_open={() => on_open_table(t.name)}
              on_view_structure={() => open_structure(conn_id, t.name)}
              on_copy={() => void copy_name(t.name)}
              on_duplicate={() => ask_duplicate(t)}
              on_drop={() => setConfirmDrop({ name: t.name, kind: t.kind })}
              on_view_grants={() => {
                setGrantsRows(null);
                setGrantsFor(t.name);
              }}
              on_refresh_matview={
                t.kind === "matview"
                  ? () =>
                      void (async () => {
                        try {
                          await refreshMatview(conn_id, t.name);
                          on_refresh();
                          push_notification({
                            kind: "success",
                            title: "Materialized view refreshed",
                            detail: t.name,
                          });
                        } catch (e) {
                          push_notification({
                            kind: "error",
                            title: "Refresh failed",
                            detail: String(e),
                          });
                        }
                      })()
                  : undefined
              }
            />
          ))
        )}
      </div>

      {/* Server-object browsers — lazy catalog reads per group. */}
      {is_pg && (
        <div className="shrink-0 rounded-md border">
          {(["Sequences", "Extensions", "Functions", "Roles"] as const).map(
            (label) => {
              const data = srv_data[label];
              return (
                <div key={label} className="border-b last:border-b-0">
                  <button
                    className="text-muted-foreground hover:bg-muted/50 flex w-full items-center gap-2 px-2 py-1.5 text-xs font-medium"
                    onClick={() => toggle_srv(label)}
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-transform",
                        srv_open === label && "rotate-90",
                      )}
                    />
                    {label}
                  </button>
                  {srv_open === label && (
                    <div className="max-h-48 overflow-y-auto px-2 pb-2">
                      {data === "loading" || data === undefined ? (
                        <p className="text-muted-foreground px-1 py-2 text-xs">
                          Loading…
                        </p>
                      ) : !data || data.rows.length === 0 ? (
                        <p className="text-muted-foreground px-1 py-2 text-xs">
                          None found.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {data.rows.map((r, i) => (
                            <li
                              key={i}
                              className="text-foreground/80 truncate rounded px-1 py-0.5 font-mono text-[11px]"
                              title={r.filter(Boolean).join(" · ")}
                            >
                              {r.filter(Boolean).join("  ·  ")}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            },
          )}
        </div>
      )}

      <Dialog
        open={confirm_drop !== null}
        onOpenChange={(open) => {
          if (!open && !dropping) setConfirmDrop(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Drop table</DialogTitle>
            <DialogDescription>
              This permanently deletes the table “{confirm_drop?.name ?? ""}”
              and its data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {dropdown_error && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
              {dropdown_error}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={dropping}
              onClick={() => void do_drop()}
            >
              {dropping ? "Dropping…" : "Drop"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirm_duplicate !== null}
        onOpenChange={(open) => {
          if (!open && !dupe_submitting) {
            setConfirmDuplicate(null);
            setDupeError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate table</DialogTitle>
            <DialogDescription>
              Create a copy of “{confirm_duplicate?.name ?? ""}” with all of its
              data.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="dupe-name">Name of the duplicate</Label>
            <Input
              id="dupe-name"
              placeholder="table_copy"
              value={dupe_name}
              onChange={(e) => setDupeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void duplicate_table();
              }}
              autoFocus
            />
          </div>
          {dupe_error && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
              {dupe_error}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={dupe_submitting}
              onClick={() => void duplicate_table()}
            >
              {dupe_submitting ? "Duplicating…" : "Duplicate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Relation grants (Postgres). */}
      <Dialog
        open={grants_for !== null}
        onOpenChange={(o) => !o && setGrantsFor(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Grants — {grants_for}</DialogTitle>
          </DialogHeader>
          {grants_rows === null ? (
            <p className="text-muted-foreground py-2 text-sm">Loading…</p>
          ) : grants_rows.length === 0 ? (
            <p className="text-muted-foreground py-2 text-sm">
              No explicit grants.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto rounded-md border">
              {grants_rows.map(([grantee, privilege], i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs last:border-b-0"
                >
                  <span className="truncate font-mono">{grantee}</span>
                  <span className="text-muted-foreground shrink-0 uppercase">
                    {privilege}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Create/drop database or schema (Postgres). */}
      <Dialog
        open={ddl_dialog !== null}
        onOpenChange={(o) => {
          if (!o && !ddl_busy) setDdlDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {ddl_dialog?.kind === "db-create" && "Create database"}
              {ddl_dialog?.kind === "db-drop" && "Drop database"}
              {ddl_dialog?.kind === "schema-create" && "Create schema"}
              {ddl_dialog?.kind === "schema-drop" && "Drop schema"}
            </DialogTitle>
          </DialogHeader>
          {ddl_dialog && (
            <div className="flex flex-col gap-3">
              {(ddl_dialog.kind === "db-create" ||
                ddl_dialog.kind === "schema-create") && (
                <Input
                  autoFocus
                  value={ddl_name}
                  onChange={(e) => setDdlName(e.target.value)}
                  placeholder={
                    ddl_dialog.kind === "db-create"
                      ? "database name"
                      : "schema name"
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void run_ddl();
                  }}
                />
              )}
              {ddl_dialog.kind.endsWith("-drop") && (
                <>
                  <p className="text-muted-foreground text-sm">
                    Permanently drop{" "}
                    <span className="text-foreground font-mono">
                      {ddl_dialog.name}
                    </span>
                    ?
                  </p>
                  {ddl_dialog.kind === "schema-drop" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={ddl_cascade}
                        onChange={(e) => setDdlCascade(e.target.checked)}
                      />
                      CASCADE — also drop every object inside it
                    </label>
                  )}
                </>
              )}
              {ddl_error && (
                <p className="wrap-break-words text-destructive font-mono text-xs">
                  {ddl_error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={ddl_busy}
              onClick={() => setDdlDialog(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant={
                ddl_dialog?.kind.endsWith("-drop") ? "destructive" : "default"
              }
              disabled={ddl_busy}
              onClick={() => void run_ddl()}
            >
              {ddl_busy
                ? "Working…"
                : ddl_dialog?.kind.endsWith("-drop")
                  ? "Drop"
                  : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TableListItem({
  name,
  kind,
  is_selected,
  disabled,
  on_select,
  on_open,
  on_view_structure,
  on_copy,
  on_duplicate,
  on_drop,
  on_refresh_matview,
  on_view_grants,
}: {
  name: string;
  kind: string;
  is_selected: boolean;
  disabled?: boolean;
  on_select: () => void;
  on_open: () => void;
  on_view_structure: () => void;
  on_view_grants: () => void;
  on_copy: () => void;
  on_duplicate: () => void;
  on_drop: () => void;
  on_refresh_matview?: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Button
            variant="ghost"
            data-table={name}
            onClick={on_select}
            onDoubleClick={on_open}
            onContextMenu={(e) => e.stopPropagation()}
            className={cn(
              "w-full justify-start px-2 py-1.5 text-left font-normal",
              is_selected ? "bg-muted font-medium" : "hover:bg-muted/50",
            )}
          >
            {kind === "table" ? (
              <TableIcon className="text-muted-foreground size-4 shrink-0" />
            ) : (
              <Eye className="text-muted-foreground size-4 shrink-0" />
            )}
            <span className="truncate font-medium">{name}</span>
            <span className="sr-only">{kind}</span>
          </Button>
        }
      />
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={on_open}>
          <TableIcon className="text-muted-foreground size-4" />
          Open table
        </ContextMenuItem>
        <ContextMenuItem onSelect={on_view_structure}>
          <Eye className="text-muted-foreground size-4" />
          View structure
        </ContextMenuItem>
        <ContextMenuItem onSelect={on_view_grants}>
          <ShieldCheck className="text-muted-foreground size-4" />
          View grants
        </ContextMenuItem>
        <ContextMenuItem onSelect={on_copy}>
          <Copy className="text-muted-foreground size-4" />
          Copy table name
        </ContextMenuItem>
        <ContextMenuItem onSelect={on_duplicate} disabled={disabled}>
          <CopyPlus className="text-muted-foreground size-4" />
          Duplicate table
        </ContextMenuItem>
        {kind === "matview" && (
          <ContextMenuItem onSelect={on_refresh_matview}>
            <RefreshCw className="text-muted-foreground size-4" />
            Refresh materialized view
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={on_drop}>
          <Trash2 className="size-4" />
          Drop table…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
