import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Loader2, X } from "lucide-react";
import type { Completion } from "@codemirror/autocomplete";
import { format as formatSql } from "sql-formatter";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { basename, cn, statementRanges } from "@/shared/lib/utils";
import { QueryResultsGrid } from "@/shared/components/data-grid/query-results-grid";
import {
  catalogOverview,
  listDatabases,
  listSchemaObjects,
  listSchemasIn,
  runMongo,
  runSqlStream,
  tableSchema,
  writeFile,
  type MongoRunResult,
  type QueryResult,
} from "@/shared/api";
import { pickSqlFile, pickSqlSavePath } from "@/shared/lib/platform";
import { useStudioStore } from "@/shared/store";
import { QueryEditor, type QueryEditorHandle } from "./editor";
import { EditorRunToolbar } from "./editor-run-toolbar";

/** A single failed-statement marker pushed to the editor via `setErrors`. */
type ErrorRange = { from: number; to: number; message: string };

/** Tracks which result-tab ids currently have a failed statement, and keeps
 *  the editor's inline diagnostics in sync as that changes. Shared between
 *  the SQL and Mongo bodies below — both run a BATCH of statements at once
 *  (run_all/run_target can fire several), so one statement's success must
 *  never wipe out another's still-pending error marker; only clearing the
 *  whole map (a fresh run, or the text changing) resets it. */
function useErrorRanges(editorRef: React.RefObject<QueryEditorHandle | null>) {
  const ranges = useRef(new Map<number, ErrorRange>());
  const sync = useCallback(() => {
    editorRef.current?.setErrors(Array.from(ranges.current.values()));
  }, [editorRef]);
  return { ranges, sync };
}

/** One row of the result strip, normalized across SQL's and Mongo's own
 *  entry shapes — just enough for the tab strip to render without caring
 *  which kind of editor it's showing. */
interface ResultTabSummary {
  id: number;
  label: string;
  running: boolean;
  has_error: boolean;
}

/** The result-tab strip: a colored status dot, a truncated label, and a
 *  close button — identical chrome for both SQL and Mongo, which otherwise
 *  differ in what a "result" even contains. */
function ResultTabStrip({
  items,
  active_id,
  on_select,
  on_close,
}: {
  items: ResultTabSummary[];
  active_id: number | null;
  on_select: (id: number) => void;
  on_close: (id: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="bg-background flex shrink-0 scrollbar-none items-center gap-0.5 overflow-x-auto border-b px-1.5 pt-1">
      {items.map((item) => (
        <div
          key={item.id}
          role="button"
          tabIndex={0}
          onClick={() => on_select(item.id)}
          className={cn(
            "flex max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-sm whitespace-nowrap select-none",
            item.id === active_id
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
          )}
        >
          {item.running ? (
            <span className="bg-primary size-2 shrink-0 animate-pulse rounded-full" />
          ) : item.has_error ? (
            <span className="bg-destructive size-2 shrink-0 rounded-full" />
          ) : (
            <span className="bg-success size-2 shrink-0 rounded-full" />
          )}
          <span className="truncate">{item.label}</span>
          <Button
            variant="ghost"
            size="iconXs"
            className="-mr-1 ml-0.5 size-5 opacity-60 hover:opacity-100"
            aria-label="Close result tab"
            onClick={(e) => {
              e.stopPropagation();
              on_close(item.id);
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Unsaved-text tracking shared by both bodies: `is_dirty` compares the
 *  live text against whatever was last saved (or, for a seed handed over
 *  from a real file via openFileTab, the seed itself — see the
 *  `seedFileNames` check below), `file_name` is what the tab strip shows
 *  once it's been saved at least once. `pick_and_write` does the
 *  kind-specific save-dialog + write; only the resulting path/bytes flow
 *  back here. `open` is the toolbar's "Open" button: loads a picked file
 *  straight into THIS tab (replacing its text) rather than opening a new
 *  one — for that, see `openFileTab` in workspace.tsx instead. */
function useUnsavedQueryTracking(
  tab_key: string,
  text: string,
  set_text: (v: string) => void,
  pick_and_write: (text: string) => Promise<string | null>,
) {
  const [saved_baseline, setSavedBaseline] = useState(() => {
    const s = useStudioStore.getState();
    return s.seedFileNames[tab_key] !== undefined
      ? (s.sqlSeeds[tab_key] ?? "")
      : "";
  });
  const [file_name, setFileName] = useState<string | null>(
    () => useStudioStore.getState().seedFileNames[tab_key] ?? null,
  );
  const is_dirty = text.trim().length > 0 && text !== saved_baseline;
  // `save` always writes the LATEST text even if a stale closure fires
  // after a fast edit — mirrors the pre-merge components' own ref pattern.
  const text_ref = useRef(text);
  useEffect(() => {
    text_ref.current = text;
  });
  const save = useCallback(async (): Promise<boolean> => {
    const path = await pick_and_write(text_ref.current);
    if (!path) return false;
    setSavedBaseline(text_ref.current);
    setFileName(basename(path));
    return true;
  }, [pick_and_write]);
  const open = useCallback(async () => {
    try {
      const file = await pickSqlFile();
      if (!file) return;
      set_text(file.text);
      setSavedBaseline(file.text);
      setFileName(file.name);
    } catch (e) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Could not open file",
        detail: String(e),
      });
    }
  }, [set_text]);
  return { is_dirty, file_name, save, open };
}

// ---- SQL --------------------------------------------------------------

interface SqlResultTab {
  id: number;
  label: string;
  result: QueryResult | null;
  running: boolean;
}

/** Completion hints shared by EVERY SQL tab in the session, keyed by
 *  `${connId} ${table}` — a second tab (or reopening one) costs zero
 *  table_schema round trips. */
const sharedCompletionCache = new Map<string, Completion[]>();

/** Whether `sql` is schema-changing DDL (adds/drops/alters a table, index,
 *  view, or trigger) rather than a plain data statement (SELECT/INSERT/
 *  UPDATE/DELETE). Used to decide whether running it from the console
 *  should also refresh any already-open grid tab for the affected table —
 *  `on_modified` alone only refreshes the sidebar's table list, by design,
 *  so an unrelated data statement doesn't disturb other open tabs' scroll/
 *  paging position. A statement this best-effort check misses just falls
 *  back to the existing "reload manually" behavior — nothing breaks. */
function is_schema_ddl(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trimStart();
  return (
    /^(alter|drop)\s+table\b/i.test(stripped) ||
    /^create\s+(or\s+replace\s+)?(table|view|trigger)\b/i.test(stripped) ||
    /^drop\s+(view|trigger)\b/i.test(stripped) ||
    /^create\s+(unique\s+)?index\b/i.test(stripped) ||
    /^drop\s+index\b/i.test(stripped)
  );
}

function SqlEditorBody({
  conn_id,
  tab_key,
  tables,
  on_modified,
  on_schema_modified,
}: {
  conn_id: string;
  tab_key: string;
  tables?: string[];
  on_modified?: () => void;
  /** Called (in addition to `on_modified`) specifically when the executed
   *  statement was schema-changing DDL — refreshes open table tabs' data
   *  AND schema, not just the sidebar's table list. */
  on_schema_modified?: () => void;
}) {
  // Seed text handed over by other features (e.g. "open edits in SQL editor"):
  // openSql(connId, text) stashes it under this tab's key; read it once here.
  // The store entry itself is removed when the tab closes.
  const [sql, setSqlRaw] = useState(
    () => useStudioStore.getState().sqlSeeds[tab_key] ?? "",
  );
  const editorRef = useRef<QueryEditorHandle>(null);
  const { ranges: error_ranges, sync: sync_errors } = useErrorRanges(editorRef);
  // Drives the run-target button wording ("Run selection" vs. "Run query"
  // at the cursor) — see QueryEditorProps.onSelectionChange.
  const [has_selection, setHasSelection] = useState(false);
  // Toolbar toggle: turns off the live syntax/unknown-table linter (run
  // errors still show regardless — a separate mechanism, see `setErrors`).
  // Sometimes wanted when writing SQL against tables the app hasn't learned
  // about yet (e.g. right after a bulk DDL run) that would otherwise flag
  // everything as "unknown".
  const [lint_enabled, setLintEnabled] = useState(true);

  // ---- Target database. Every kind but SQLite (single-file, no such
  // concept within one connection) supports switching it — including a
  // MongoDB connection's SQL tab (Phase-4 SQL-on-Mongo translates the
  // query, but still targets a real database — same `database` param
  // `run_sql` already takes for Postgres). The Mongo CONSOLE tab
  // (`MongoEditorBody` below) is separate and has its own `db` state; this
  // is specifically the plain "SQL" tab kind, usable against either
  // dialect. Defaults to the connection's own primary database; every run
  // targets whichever database is currently selected.
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const is_pg = conn?.kind === "postgres";
  const supports_multi_db = conn?.kind !== "sqlite";
  const recent_params = useStudioStore((s) => s.recentParams[conn_id]);
  const own_database = recent_params?.database ?? conn?.name ?? "";
  const [database, setDatabase] = useState("");
  const [databases, setDatabases] = useState<string[]>([]);
  useEffect(() => {
    if (!supports_multi_db) return;
    let cancelled = false;
    void listDatabases(conn_id)
      .then((list) => {
        if (cancelled) return;
        setDatabases(list);
        setDatabase(own_database);
      })
      .catch(() => {
        /* picker stays empty — every run just targets the own database */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- own_database intentionally excluded: derived from the same conn_id, only needs its initial value here
  }, [conn_id, supports_multi_db]);
  const target_database =
    database && database !== own_database ? database : undefined;

  // ---- Known schemas + their table lists (Postgres only) — there's no
  // separate schema PICKER: the user names a non-default schema straight in
  // the query (`public.users`, `otherschema.orders`), and this is what lets
  // the editor still hint/lint those references correctly instead of only
  // ever knowing about the default schema's tables (see
  // `schemaCompletions`'s doc comment for the full reasoning).
  const [known_schemas, setKnownSchemas] = useState<string[]>([]);
  useEffect(() => {
    if (!is_pg || !database) return;
    let cancelled = false;
    void listSchemasIn(
      conn_id,
      database === own_database ? undefined : database,
    )
      .then((list) => {
        if (!cancelled) setKnownSchemas(list);
      })
      .catch(() => {
        /* stays empty — hints just fall back to the `tables` prop below */
      });
    return () => {
      cancelled = true;
    };
  }, [conn_id, is_pg, database, own_database]);

  // Every known schema's table list — cheap (names only), so fetched eagerly
  // for all of them at once rather than waiting on the user to reference one
  // first. Powers the `schema.` → table-name completions.
  const [schema_tables, setSchemaTables] = useState<Record<string, string[]>>(
    {},
  );
  const schema_tables_cache = useRef(new Map<string, string[]>());
  useEffect(() => {
    if (!is_pg || known_schemas.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const s of known_schemas) {
          if (cancelled) return;
          const cache_key = `${conn_id} ${database} ${s}`;
          if (schema_tables_cache.current.has(cache_key)) continue;
          try {
            const objects = await listSchemaObjects(
              conn_id,
              s,
              "table",
              target_database,
            );
            schema_tables_cache.current.set(
              cache_key,
              objects.map((o) => o.name),
            );
          } catch {
            schema_tables_cache.current.set(cache_key, []);
          }
        }
        if (cancelled) return;
        const next: Record<string, string[]> = {};
        for (const s of known_schemas) {
          next[s] =
            schema_tables_cache.current.get(`${conn_id} ${database} ${s}`) ??
            [];
        }
        setSchemaTables(next);
      })();
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conn_id, is_pg, database, target_database, known_schemas]);

  // Collection names for the CURRENTLY SELECTED database (MongoDB's SQL tab
  // only — Postgres has its own per-schema fetch above, SQLite has no
  // multi-database concept at all). Without this, switching the toolbar's
  // database dropdown left `tables`/hints/lint pinned to whatever the
  // (primary-database-only) `tables` prop was seeded with, so an unqualified
  // table reference against the NEW database kept linting as "unknown" and
  // vice versa.
  const [mongo_db_tables, setMongoDbTables] = useState<string[]>([]);
  useEffect(() => {
    if (conn?.kind !== "mongodb" || !database) return;
    let cancelled = false;
    void listSchemaObjects(conn_id, "", "table", target_database)
      .then((objects) => {
        if (!cancelled) setMongoDbTables(objects.map((o) => o.name));
      })
      .catch(() => {
        /* stays whatever it was — hints/lint just fall back to `tables` below */
      });
    return () => {
      cancelled = true;
    };
  }, [conn_id, conn?.kind, database, target_database]);

  // Bare (unqualified) table names for hints — the UNION across every known
  // schema, not just the default one: `FROM <table>` completions/lint work
  // regardless of which schema a table actually lives in, same as typing no
  // schema at all means "look everywhere" for the real database too. Only
  // once the user types `schema.` does a specific one narrow it down (via
  // `schemaTables` below). A name shared by two schemas just collides into
  // one bare entry — nothing to disambiguate without a real scope, same as
  // any unqualified reference. Falls back to the (primary-database) `tables`
  // prop while `schema_tables` hasn't resolved yet, rather than flashing
  // empty completions/lint for that gap — also the whole story for SQLite,
  // which has no schema concept at all.
  // Memoized: a fresh array every render (this component re-renders on
  // every keystroke) would retrigger the column-completions prefetch
  // effect below on every keystroke too, since it depends on this by
  // reference — see that effect's own comment.
  const effective_tables = useMemo(
    () =>
      is_pg
        ? Object.keys(schema_tables).length > 0
          ? [...new Set(Object.values(schema_tables).flat())]
          : tables
        : conn?.kind === "mongodb"
          ? mongo_db_tables.length > 0
            ? mongo_db_tables
            : tables
          : tables,
    [is_pg, schema_tables, tables, conn?.kind, mongo_db_tables],
  );

  const setSql = useCallback(
    (v: string) => {
      const text = v ?? "";
      setSqlRaw(text);
      // Keeps sqlSeeds live (not just the one-shot initial value) so
      // workspace-persistence.ts can snapshot "what the user was typing".
      useStudioStore.getState().updateSqlSeed(tab_key, text);
      if (error_ranges.current.size > 0) {
        error_ranges.current.clear();
        sync_errors();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above `run_query`'s own deps array
    [sync_errors, tab_key, error_ranges.current],
  );
  // Belt-and-suspenders: every consumer below reads THIS, never `sql`
  // directly — guards every `.trim()`/`.slice()` call against ever seeing a
  // non-string value, whatever the actual source of a bad update turns out
  // to be (e.g. dev-mode HMR preserving a stale/mismatched state shape).
  const sql_text = typeof sql === "string" ? sql : String(sql ?? "");
  const format_sql = useCallback(() => {
    try {
      setSql(
        formatSql(sql_text, {
          language: is_pg
            ? "postgresql"
            : conn?.kind === "sqlite"
              ? "sqlite"
              : "sql",
        }),
      );
    } catch {
      // Leave the text untouched — sql-formatter throws on SQL it can't
      // parse (mid-edit, a dialect quirk it doesn't know); silently doing
      // nothing beats replacing a query the user was actively writing.
    }
  }, [sql_text, is_pg, conn, setSql]);
  const [tabs, setTabs] = useState<SqlResultTab[]>([]);
  const [active_id, setActiveId] = useState<number | null>(null);
  const next_id = useRef(0);
  const next_label = useRef(1);

  // Column completions per table for the editor: a bare `"table"` key for
  // every table in every known schema (drives plain `table.`/`alias.`
  // completions and field-position suggestions the same way regardless of
  // which schema it actually lives in — see `effective_tables`'s own doc
  // comment for why), PLUS a `"schema.table"` key for each so
  // `schema.table.` completes correctly once the user does name one.
  // SQLite (no `schema_tables` at all) just gets bare keys for the plain
  // `tables` prop, same as before this had any schema awareness.
  const [schema, setSchema] = useState<Record<string, Completion[]>>({});
  // Completion hints per `${connId} ${database} ${schema} ${table}`, shared
  // by EVERY SQL tab in the session — a second tab (or reopening one) costs
  // zero describes. Database/schema are part of the key (not just the
  // table name) so the same-named table in a different database/schema
  // never serves another one's stale column list.
  const schema_cache = useRef(sharedCompletionCache);

  useEffect(() => {
    const targets: { schema: string | undefined; table: string }[] = is_pg
      ? Object.entries(schema_tables).flatMap(([s, ts]) =>
          ts.map((t) => ({ schema: s, table: t })),
        )
      : (effective_tables ?? []).map((t) => ({ schema: undefined, table: t }));
    if (targets.length === 0) return;
    let cancelled = false;
    // BACKGROUND prefetch: strictly SEQUENTIAL with an idle delay. A parallel
    // flood of N describes used to saturate the connection pool and delay the
    // user's first real query (table opens felt stuck behind it).
    const timer = setTimeout(() => {
      void (async () => {
        for (const { schema: s, table: t } of targets) {
          if (cancelled) return;
          const cache_key = `${conn_id} ${target_database ?? ""} ${s ?? ""} ${t}`;
          if (schema_cache.current.has(cache_key)) continue;
          try {
            const described = await tableSchema(conn_id, t, target_database, s);
            schema_cache.current.set(
              cache_key,
              described.columns.map((c) => ({
                label: c.name,
                type: "property",
                detail: c.data_type,
              })),
            );
          } catch {
            // ignore per-table failures; that table just gets no column hints
          }
        }
        if (cancelled) return;
        const next: Record<string, Completion[]> = {};
        for (const { schema: s, table: t } of targets) {
          const cache_key = `${conn_id} ${target_database ?? ""} ${s ?? ""} ${t}`;
          const cols = schema_cache.current.get(cache_key);
          if (!cols) continue;
          // Bare key always (last schema to resolve wins on a name shared
          // across schemas — see `effective_tables`); qualified key too
          // when there's a schema to qualify with.
          next[t] = cols;
          if (s) next[`${s}.${t}`] = cols;
        }
        setSchema(next);
      })();
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conn_id, is_pg, target_database, schema_tables, effective_tables]);

  const add_tab = useCallback((): number => {
    const id = ++next_id.current;
    setTabs((cur) => [
      ...cur,
      {
        id,
        label: `Query ${next_label.current++}`,
        result: null,
        running: false,
      },
    ]);
    setActiveId(id);
    return id;
  }, []);

  const patch_tab = useCallback((id: number, patch: Partial<SqlResultTab>) => {
    setTabs((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const close_tab = useCallback((id: number) => {
    setTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === id);
      const nextList = cur.filter((t) => t.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        const next = nextList[Math.max(0, idx - 1)];
        return next ? next.id : null;
      });
      return nextList;
    });
  }, []);

  const run_query = useCallback(
    async (id: number, query: string, range?: { from: number; to: number }) => {
      patch_tab(id, { running: true, result: null });
      // Accumulate streamed rows; flush to the tab at most once per frame so
      // large results paint progressively without a render per batch.
      const acc: { cols: string[] | null; rows: (string | null)[][] } = {
        cols: null,
        rows: [],
      };
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (acc.rows.length === 0) return;
        patch_tab(id, {
          result: {
            columns: acc.cols ?? [],
            rows: [...acc.rows],
            rows_affected: 0,
            is_select: true,
            error: null,
            elapsed_ms: 0,
          },
        });
      };
      let res: QueryResult;
      try {
        res = await runSqlStream(
          conn_id,
          query,
          (chunk) => {
            if (chunk.columns) acc.cols = chunk.columns;
            if (chunk.rows.length > 0) {
              acc.rows.push(...chunk.rows);
              if (!raf) raf = requestAnimationFrame(flush);
            }
          },
          target_database,
        );
      } catch (e) {
        res = {
          columns: [],
          rows: [],
          rows_affected: 0,
          is_select: false,
          error: String(e),
          elapsed_ms: 0,
        };
      }
      if (raf) cancelAnimationFrame(raf);
      if (!res.is_select && !res.error) {
        on_modified?.();
        if (is_schema_ddl(query)) on_schema_modified?.();
      }
      // The resolved metadata is authoritative; pair it with accumulated rows.
      patch_tab(id, {
        running: false,
        result: res.is_select ? { ...res, rows: acc.rows } : res,
      });
      if (range) {
        if (res.error)
          error_ranges.current.set(id, { ...range, message: res.error });
        else error_ranges.current.delete(id);
        sync_errors();
        editorRef.current?.markRunResult(res.error ? null : range);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; the React Compiler's own preserve-manual-memoization rule requires `.current` specifically here, which exhaustive-deps then (correctly, in the general case) flags as not a valid dependency — a genuine conflict between the two rules, not a missing dependency
    [
      patch_tab,
      conn_id,
      target_database,
      on_modified,
      on_schema_modified,
      sync_errors,
      error_ranges.current,
    ],
  );

  const run_all = useCallback(() => {
    const stmts = statementRanges(sql_text)
      .map((r) => ({
        from: r.start,
        to: r.end,
        text: sql_text.slice(r.start, r.end).trim(),
      }))
      .filter((s) => s.text);
    if (stmts.length === 0) return;
    // Fresh batch — previous run's error markers no longer apply.
    error_ranges.current.clear();
    sync_errors();
    for (const s of stmts) {
      const id = add_tab();
      void run_query(id, s.text, { from: s.from, to: s.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above run_query's own deps array
  }, [sql_text, add_tab, run_query, sync_errors, error_ranges.current]);

  const run_target = useCallback(() => {
    const targets = editorRef.current?.getTargets() ?? [];
    if (targets.length === 0) return;
    error_ranges.current.clear();
    sync_errors();
    for (const t of targets) {
      const text = t.text.trim();
      if (!text) continue;
      const id = add_tab();
      void run_query(id, text, { from: t.from, to: t.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above run_query's own deps array
  }, [add_tab, run_query, sync_errors, error_ranges.current]);

  const active = tabs.find((t) => t.id === active_id) ?? null;
  // Rows/time for the action bar (no GridBridge for SQL results — they're
  // not paginated/editable) — null while running or on error, since there's
  // nothing meaningful to show then. Memoized so its identity is stable
  // across renders where the underlying values don't change (the effect
  // below re-registers whenever this object changes).
  const result = active?.result;
  const result_summary = useMemo(
    () =>
      active && !active.running && result && !result.error
        ? {
            rows: result.is_select ? result.rows.length : result.rows_affected,
            is_select: result.is_select,
            elapsed_ms: result.elapsed_ms,
          }
        : null,
    [active, result],
  );

  const pick_and_write = useCallback(async (text: string) => {
    const path = await pickSqlSavePath();
    if (!path) return null;
    await writeFile(path, Array.from(new TextEncoder().encode(text)));
    return path;
  }, []);
  const {
    is_dirty,
    file_name,
    save: save_sql,
    open: open_sql_file,
  } = useUnsavedQueryTracking(tab_key, sql_text, setSql, pick_and_write);

  const set_sql_tab = useStudioStore((s) => s.setSqlTab);
  const clear_sql_tab = useStudioStore((s) => s.clearSqlTab);
  useEffect(() => {
    set_sql_tab(tab_key, {
      has_text: sql_text.trim().length > 0,
      is_dirty,
      can_run_target: sql_text.trim().length > 0,
      save: save_sql,
      run_all,
      run_target,
      has_selection,
      result: result_summary,
      file_name,
    });
    // Re-registers whenever the dirty flag, filename, or active result
    // flips; cleanup on unmount.
    return () => clear_sql_tab(tab_key);
  }, [
    tab_key,
    sql_text,
    is_dirty,
    file_name,
    save_sql,
    run_all,
    run_target,
    has_selection,
    result_summary,
    set_sql_tab,
    clear_sql_tab,
  ]);

  const strip_items: ResultTabSummary[] = tabs.map((t) => ({
    id: t.id,
    label: t.label,
    running: t.running,
    has_error: !!t.result?.error,
  }));

  const editor_pane = (
    <div className="flex h-full min-h-0 flex-col">
      <EditorRunToolbar
        has_selection={has_selection}
        can_run_target={sql_text.trim().length > 0}
        has_text={sql_text.trim().length > 0}
        on_run_target={run_target}
        on_run_all={run_all}
        db_kind={conn?.kind}
        database={supports_multi_db ? database : undefined}
        databases={supports_multi_db ? databases : undefined}
        on_database_change={supports_multi_db ? setDatabase : undefined}
        on_format={format_sql}
        lint_enabled={lint_enabled}
        on_toggle_lint={() => setLintEnabled((v) => !v)}
        is_dirty={is_dirty}
        on_save={() => void save_sql()}
        on_open={() => void open_sql_file()}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <QueryEditor
          ref={editorRef}
          value={sql_text}
          onChange={setSql}
          onRun={() => void run_all()}
          onRunTarget={run_target}
          onSelectionChange={setHasSelection}
          onSave={() => void save_sql()}
          tables={effective_tables}
          schema={schema}
          schemaTables={is_pg ? schema_tables : undefined}
          lintEnabled={lint_enabled}
          height="100%"
        />
      </div>
    </div>
  );

  // No result tabs yet: give the editor the full pane instead of splitting
  // 40/60 with an empty results section underneath it.
  if (tabs.length === 0) {
    return <div className="flex h-full min-h-0 flex-col">{editor_pane}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel
          defaultSize="40%"
          minSize="15%"
          className="flex-col border-b"
        >
          {editor_pane}
        </ResizablePanel>

        <ResizableHandle className="bg-background hover:bg-accent h-1!" />

        <ResizablePanel
          defaultSize="60%"
          minSize="25%"
          className="bg-background flex-col"
        >
          <div className="flex h-full min-h-0 flex-col">
            <ResultTabStrip
              items={strip_items}
              active_id={active_id}
              on_select={setActiveId}
              on_close={close_tab}
            />
            <div className="min-h-0 flex-1 overflow-auto" data-selectable>
              {active === null ? (
                <div className="text-muted-foreground m-6 rounded-md border border-dashed p-10 text-center text-sm">
                  Run a query to see results. Each run opens its own result tab.
                </div>
              ) : active.running ? (
                <div className="flex flex-col gap-2 pt-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="bg-muted h-8 animate-pulse rounded-md"
                    />
                  ))}
                </div>
              ) : active.result ? (
                <SqlResults
                  conn_id={conn_id}
                  tab_key={tab_key}
                  result={active.result}
                />
              ) : null}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function SqlResults({
  result,
  conn_id,
  tab_key,
}: {
  result: QueryResult;
  conn_id: string;
  tab_key: string;
}) {
  // Row count/elapsed time show in the action bar (via the sqlTabs handle's
  // `result` field) instead of here, matching where the regular table grid
  // shows the same info — the result tab strip's colored dot already covers
  // running/success/error status, so this pane only needs to show content.
  if (result.is_select)
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden border">
        <QueryResultsGrid result={result} conn_id={conn_id} tab_key={tab_key} />
      </div>
    );

  if (result.error)
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive m-4 rounded-md border px-3 py-2 text-sm">
        {result.error}
      </div>
    );

  return (
    <div className="text-muted-foreground m-4 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
      <Badge>Done</Badge>
    </div>
  );
}

// ---- Mongo --------------------------------------------------------------

const DEFAULT_SCRIPT = ``;

interface MongoEntry {
  id: number;
  command: string;
  result: MongoRunResult | null;
  running: boolean;
}

/** Strip `//` comment lines — the console's commands are the real payload. */
function strip_comments(s: string): string {
  return s
    .split("\n")
    .map((l) => (l.trim().startsWith("//") ? "" : l))
    .join("\n")
    .trim();
}

/** A singleton MongoDB console per connection. Accepts JSON find/aggregate
 *  queries and a small shell subset (`use`, `show dbs`, `show collections`,
 *  `db.<coll>.find/count/countDocuments/distinct/aggregate`). No JS is
 *  evaluated — commands are parsed and executed directly. The editor is a
 *  JavaScript-flavoured CodeMirror instance (shared with the SQL editor) so
 *  commands get syntax colors, and run-all / run-selection behave like SQL. */
function MongoEditorBody({
  conn_id,
  tab_key,
  database,
  on_modified,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
  /** Called after a successful write (insertOne/updateMany/deleteOne/…) so
   *  an already-open grid tab on the same collection refreshes instead of
   *  showing stale data until a manual reload. */
  on_modified?: () => void;
}) {
  // The connection's own database vs. the CURRENT one (switched via the
  // toolbar picker below, or by typing `use <db>` — both update `db`,
  // console has always supported the latter, the picker is just a more
  // discoverable way to do the same thing).
  const [db, setDb] = useState(database);
  const [databases, setDatabases] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void catalogOverview(conn_id)
      .then((overview) => {
        if (!cancelled) setDatabases(overview.databases);
      })
      .catch(() => {
        /* picker stays empty — `use <db>` still works as free text */
      });
    return () => {
      cancelled = true;
    };
  }, [conn_id]);
  // Collection names, offered as `db.<TAB>` completions — bare JSON queries
  // (no `db.<collection>.` prefix) aren't supported; every command names its
  // collection explicitly, same as the real Mongo shell. Refetched on every
  // `db` change (including a typed `use <db>`, not just the picker) — this
  // used to only ever fetch the connection's OWN database once on mount,
  // silently offering the wrong database's collection names after a switch.
  const [collections, setCollections] = useState<string[]>([]);
  // Seed text handed over by other features (e.g. opening a picked .js file):
  // openMongoConsole(connId, database, text) stashes it under this tab's key;
  // read it once here. The store entry itself is removed when the tab closes
  // (same one-shot mechanism openSql uses for the SQL side).
  const [script, setScriptRaw] = useState(
    () => useStudioStore.getState().sqlSeeds[tab_key] ?? DEFAULT_SCRIPT,
  );
  const editorRef = useRef<QueryEditorHandle>(null);
  const { ranges: error_ranges, sync: sync_errors } = useErrorRanges(editorRef);
  // Drives the action bar's run-target button wording ("Run selection" vs.
  // "Run query" at the cursor) — see QueryEditorProps.onSelectionChange.
  const [has_selection, setHasSelection] = useState(false);
  // Toolbar toggle for the live shell-syntax linter — see the identical
  // state in SqlEditorBody above.
  const [lint_enabled, setLintEnabled] = useState(true);
  const setScript = useCallback(
    (v: string) => {
      const text = v ?? DEFAULT_SCRIPT;
      setScriptRaw(text);
      // Keeps sqlSeeds live (not just the one-shot initial value) so
      // workspace-persistence.ts can snapshot "what the user was typing".
      useStudioStore.getState().updateSqlSeed(tab_key, text);
      // Stale error markers stop meaning anything once the text they were
      // pointing at has changed.
      if (error_ranges.current.size > 0) {
        error_ranges.current.clear();
        sync_errors();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above run_query's own deps array
    [sync_errors, tab_key, error_ranges.current],
  );
  // Belt-and-suspenders: every consumer below reads THIS, never the raw
  // state directly — closes off any path (even one the setter guard above
  // doesn't cover, e.g. dev-mode HMR preserving a stale/mismatched state
  // shape across an edit to this file) that could hand a non-string to
  // `.trim()`/`.slice()`/CodeMirror's `value` prop.
  const script_text =
    typeof script === "string" ? script : String(script ?? "");
  // Dynamically imported (not a static import up top) so prettier's
  // standalone bundle + babel/estree plugins — sizeable, and this is the
  // only place in the app that would ever need them — only ever load once
  // the user actually clicks Format, not on every editor mount.
  const format_script = useCallback(async () => {
    try {
      const [{ format }, babel, estree] = await Promise.all([
        import("prettier/standalone"),
        import("prettier/plugins/babel"),
        import("prettier/plugins/estree"),
      ]);
      const formatted = await format(script_text, {
        parser: "babel",
        plugins: [babel.default, estree.default],
      });
      setScript(formatted);
    } catch {
      // Leave the text untouched — e.g. a `use <db>` shell command isn't
      // valid JS, so a script mixing it in fails to parse; same fallback
      // as the SQL editor's format_sql.
    }
  }, [script_text, setScript]);
  const [entries, setEntries] = useState<MongoEntry[]>([]);
  const [active_id, setActiveId] = useState<number | null>(null);
  const next_id = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const objects = await listSchemaObjects(
          conn_id,
          "",
          "table",
          db && db !== database ? db : undefined,
        );
        if (!cancelled) setCollections(objects.map((o) => o.name));
      } catch {
        /* sidebar already reports connection errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, db, database]);

  const patch = useCallback((id: number, p: Partial<MongoEntry>) => {
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...p } : e)));
  }, []);

  const run_query = useCallback(
    async (id: number, text: string, range?: { from: number; to: number }) => {
      patch(id, { running: true, result: null });
      const flag_error = (message: string) => {
        if (!range) return;
        error_ranges.current.set(id, { ...range, message });
        sync_errors();
      };
      try {
        const res = await runMongo(conn_id, db, null, text);
        patch(id, { result: res });
        if (res.switch_db) setDb(res.switch_db);
        if (res.error) {
          flag_error(res.error);
          if (range) editorRef.current?.markRunResult(null);
        } else {
          if (range) {
            error_ranges.current.delete(id);
            sync_errors();
            editorRef.current?.markRunResult(range);
          }
          if (!res.is_select) on_modified?.();
        }
      } catch (e) {
        const message = String(e);
        patch(id, {
          result: {
            command: text,
            columns: [],
            rows: [],
            documents: [],
            rows_affected: 0,
            is_select: false,
            message: null,
            error: message,
            switch_db: null,
            elapsed_ms: 0,
          },
        });
        flag_error(message);
        if (range) editorRef.current?.markRunResult(null);
      } finally {
        patch(id, { running: false });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above SqlEditorBody's run_query
    [patch, conn_id, db, sync_errors, on_modified, error_ranges.current],
  );

  const add_tab = useCallback(
    (text: string, range?: { from: number; to: number }) => {
      const id = ++next_id.current;
      setEntries((cur) => [
        ...cur,
        { id, command: text, result: null, running: true },
      ]);
      setActiveId(id);
      void run_query(id, text, range);
    },
    [run_query],
  );

  const run_all = useCallback(() => {
    const stmts = statementRanges(script_text)
      .map((r) => ({
        from: r.start,
        to: r.end,
        text: strip_comments(script_text.slice(r.start, r.end)),
      }))
      .filter((s) => s.text);
    if (stmts.length === 0) return;
    // Fresh batch — previous run's error markers no longer apply.
    error_ranges.current.clear();
    sync_errors();
    // Each statement runs as its own result tab, exactly like the SQL editor.
    for (const s of stmts) add_tab(s.text, { from: s.from, to: s.to });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above SqlEditorBody's run_query
  }, [script_text, add_tab, sync_errors, error_ranges.current]);

  const run_target = useCallback(() => {
    const targets = editorRef.current?.getTargets() ?? [];
    if (targets.length === 0) return;
    error_ranges.current.clear();
    sync_errors();
    for (const t of targets) {
      const cleaned = strip_comments(t.text);
      if (cleaned) add_tab(cleaned, { from: t.from, to: t.to });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- error_ranges is a stable ref; see the identical note above SqlEditorBody's run_query
  }, [add_tab, sync_errors, error_ranges.current]);

  const close_tab = useCallback((id: number) => {
    setEntries((cur) => {
      const idx = cur.findIndex((e) => e.id === id);
      const nextList = cur.filter((e) => e.id !== id);
      setActiveId((active) => {
        if (active !== id) return active;
        const next = nextList[Math.max(0, idx - 1)];
        return next ? next.id : null;
      });
      return nextList;
    });
  }, []);

  const active = entries.find((e) => e.id === active_id) ?? null;

  const pick_and_write = useCallback(async (text: string) => {
    const path = await saveDialog({
      defaultPath: "console.js",
      filters: [{ name: "JavaScript console", extensions: ["js"] }],
    });
    if (!path || Array.isArray(path)) return null;
    await writeFile(path, Array.from(new TextEncoder().encode(text)));
    return path;
  }, []);
  const {
    is_dirty,
    file_name,
    save: save_script,
    open: open_script_file,
  } = useUnsavedQueryTracking(tab_key, script_text, setScript, pick_and_write);

  const set_sql_tab = useStudioStore((s) => s.setSqlTab);
  const clear_sql_tab = useStudioStore((s) => s.clearSqlTab);
  useEffect(() => {
    set_sql_tab(tab_key, {
      has_text: script_text.trim().length > 0,
      is_dirty,
      can_run_target: script_text.trim().length > 0,
      save: save_script,
      run_all,
      run_target,
      has_selection,
      file_name,
    });
    return () => clear_sql_tab(tab_key);
  }, [
    tab_key,
    script_text,
    is_dirty,
    file_name,
    save_script,
    run_all,
    run_target,
    has_selection,
    set_sql_tab,
    clear_sql_tab,
  ]);

  const strip_items: ResultTabSummary[] = entries.map((e) => ({
    id: e.id,
    label: e.command.split("\n")[0].slice(0, 40),
    running: e.running,
    has_error: !!e.result?.error,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel
          defaultSize="38%"
          minSize="15%"
          className="flex-col border-b"
        >
          <div className="flex h-full min-h-0 flex-col">
            <EditorRunToolbar
              has_selection={has_selection}
              can_run_target={script_text.trim().length > 0}
              has_text={script_text.trim().length > 0}
              on_run_target={run_target}
              on_run_all={run_all}
              db_kind="mongodb"
              database={db}
              databases={databases}
              on_database_change={setDb}
              on_format={() => void format_script()}
              lint_enabled={lint_enabled}
              on_toggle_lint={() => setLintEnabled((v) => !v)}
              is_dirty={is_dirty}
              on_save={() => void save_script()}
              on_open={() => void open_script_file()}
            />
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              <QueryEditor
                ref={editorRef}
                value={script_text}
                onChange={setScript}
                onRun={() => void run_all()}
                onRunTarget={run_target}
                onSelectionChange={setHasSelection}
                onSave={() => void save_script()}
                language="js"
                jsCompletions={collections}
                connId={conn_id}
                lintEnabled={lint_enabled}
                height="100%"
              />
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle className="bg-background hover:bg-accent h-1!" />

        <ResizablePanel defaultSize="62%" minSize="25%" className="flex-col">
          <div className="flex h-full min-h-0 flex-col">
            <ResultTabStrip
              items={strip_items}
              active_id={active_id}
              on_select={setActiveId}
              on_close={close_tab}
            />
            <div className="min-h-0 flex-1 overflow-auto" data-selectable>
              {!active ? (
                <div className="text-muted-foreground m-4 rounded-md border border-dashed p-10 text-center text-sm">
                  Run a command to see results. Each run opens its own result
                  tab.
                </div>
              ) : active.running ? (
                <div className="flex h-full min-h-0 items-center justify-center p-3">
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                </div>
              ) : active.result ? (
                <MongoResults
                  entry={active}
                  conn_id={conn_id}
                  tab_key={tab_key}
                />
              ) : null}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function MongoResults({
  entry,
  conn_id,
  tab_key,
}: {
  entry: MongoEntry;
  conn_id: string;
  tab_key: string;
}) {
  const result = entry.result!;
  if (result.error)
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive m-4 rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
        {result.error}
      </div>
    );
  const query_result: QueryResult = {
    columns: result.columns,
    rows: result.rows,
    rows_affected: result.rows_affected,
    is_select: result.is_select,
    error: result.error,
    elapsed_ms: result.elapsed_ms,
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {result.message && (
        <span className="text-muted-foreground shrink-0 p-2 text-xs">
          {result.message}
        </span>
      )}
      <QueryResultsGrid
        result={query_result}
        conn_id={conn_id}
        tab_key={tab_key}
      />
    </div>
  );
}

// ---- Public entry point --------------------------------------------------

export type EditorTabProps =
  | {
      kind: "sql";
      conn_id: string;
      tab_key: string;
      tables?: string[];
      on_modified?: () => void;
      /** Called specifically when a run statement was schema-changing DDL —
       *  wire to a broader refresh than `on_modified` (open table tabs'
       *  data AND schema, not just the sidebar's table list). */
      on_schema_modified?: () => void;
    }
  | {
      kind: "mongo-console";
      conn_id: string;
      tab_key: string;
      database: string;
      /** Called after a successful write (insertOne/updateMany/deleteOne/…)
       *  so an already-open grid tab on the same collection refreshes. */
      on_modified?: () => void;
    };

/** The SQL console and the Mongo shell console are the same shape end to
 *  end — one query editor, a strip of independent result tabs (one per run
 *  statement), unsaved-text tracking wired into the action bar's Save
 *  button — differing only in how a query actually runs and what a result
 *  looks like. Kept in one file (dispatching on `kind`) so that shape stays
 *  obviously in sync instead of drifting between two copies. */
export function EditorTab(props: EditorTabProps) {
  if (props.kind === "sql") {
    return (
      <SqlEditorBody
        conn_id={props.conn_id}
        tab_key={props.tab_key}
        tables={props.tables}
        on_modified={props.on_modified}
        on_schema_modified={props.on_schema_modified}
      />
    );
  }
  return (
    <MongoEditorBody
      conn_id={props.conn_id}
      tab_key={props.tab_key}
      database={props.database}
      on_modified={props.on_modified}
    />
  );
}
