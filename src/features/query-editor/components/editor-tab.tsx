import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Loader2, X } from "lucide-react";
import type { Completion } from "@codemirror/autocomplete";
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
  listTables,
  runMongo,
  runSqlStream,
  tableSchema,
  writeFile,
  type MongoRunResult,
  type QueryResult,
} from "@/shared/api";
import { pickSqlSavePath } from "@/shared/lib/platform";
import { useStudioStore } from "@/shared/store";
import { QueryEditor, type QueryEditorHandle } from "./editor";

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
 *  back here. */
function useUnsavedQueryTracking(
  tab_key: string,
  text: string,
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
  return { is_dirty, file_name, save };
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
  // Drives the action bar's run-target button wording ("Run selection" vs.
  // "Run query" at the cursor) — see QueryEditorProps.onSelectionChange.
  const [has_selection, setHasSelection] = useState(false);
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
    [sync_errors, tab_key],
  );
  // Belt-and-suspenders: every consumer below reads THIS, never `sql`
  // directly — guards every `.trim()`/`.slice()` call against ever seeing a
  // non-string value, whatever the actual source of a bad update turns out
  // to be (e.g. dev-mode HMR preserving a stale/mismatched state shape).
  const sql_text = typeof sql === "string" ? sql : String(sql ?? "");
  const [tabs, setTabs] = useState<SqlResultTab[]>([]);
  const [active_id, setActiveId] = useState<number | null>(null);
  const next_id = useRef(0);
  const next_label = useRef(1);

  // Column completions per table for the editor. Fetched once per table
  // (cached across refreshes) whenever the table list changes.
  const [schema, setSchema] = useState<Record<string, Completion[]>>({});
  // Completion hints per `${connId} ${table}`, shared by EVERY SQL tab
  // in the session — a second tab (or reopening one) costs zero describes.
  const schema_cache = useRef(sharedCompletionCache);
  const tables_ref = useRef(tables);
  useEffect(() => {
    tables_ref.current = tables;
  });
  const table_key = useMemo(() => (tables ?? []).join(" "), [tables]);

  useEffect(() => {
    const list = tables_ref.current;
    if (!list || list.length === 0) return;
    let cancelled = false;
    // BACKGROUND prefetch: strictly SEQUENTIAL with an idle delay. A parallel
    // flood of N describes used to saturate the connection pool and delay the
    // user's first real query (table opens felt stuck behind it).
    const timer = setTimeout(() => {
      void (async () => {
        for (const t of list) {
          if (cancelled) return;
          const cache_key = `${conn_id} ${t}`;
          if (schema_cache.current.has(cache_key)) continue;
          try {
            const s = await tableSchema(conn_id, t);
            schema_cache.current.set(
              cache_key,
              s.columns.map((c) => ({
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
        for (const t of list) {
          const cols = schema_cache.current.get(`${conn_id} ${t}`);
          if (cols) next[t] = cols;
        }
        setSchema(next);
      })();
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conn_id, table_key]);

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
        res = await runSqlStream(conn_id, query, (chunk) => {
          if (chunk.columns) acc.cols = chunk.columns;
          if (chunk.rows.length > 0) {
            acc.rows.push(...chunk.rows);
            if (!raf) raf = requestAnimationFrame(flush);
          }
        });
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
      }
    },
    [patch_tab, conn_id, on_modified, on_schema_modified, sync_errors],
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
  }, [sql_text, add_tab, run_query, sync_errors]);

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
  }, [add_tab, run_query, sync_errors]);

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
  } = useUnsavedQueryTracking(tab_key, sql_text, pick_and_write);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel
          defaultSize="40%"
          minSize="15%"
          className="bg-background flex-col pb-3"
        >
          <div className="flex h-full min-h-0 flex-col gap-3">
            <QueryEditor
              ref={editorRef}
              value={sql_text}
              onChange={setSql}
              onRun={() => void run_all()}
              onRunTarget={run_target}
              onSelectionChange={setHasSelection}
              onSave={() => void save_sql()}
              tables={tables}
              schema={schema}
              height="100%"
            />
          </div>
        </ResizablePanel>

        <ResizableHandle className="bg-background hover:bg-accent h-1!" />

        <ResizablePanel defaultSize="60%" minSize="25%" className="flex-col border-t">
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
  const [db, setDb] = useState(database);
  // Collection names, offered as `db.<TAB>` completions — bare JSON queries
  // (no `db.<collection>.` prefix) aren't supported; every command names its
  // collection explicitly, same as the real Mongo shell.
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
    [sync_errors, tab_key],
  );
  // Belt-and-suspenders: every consumer below reads THIS, never the raw
  // state directly — closes off any path (even one the setter guard above
  // doesn't cover, e.g. dev-mode HMR preserving a stale/mismatched state
  // shape across an edit to this file) that could hand a non-string to
  // `.trim()`/`.slice()`/CodeMirror's `value` prop.
  const script_text =
    typeof script === "string" ? script : String(script ?? "");
  const [entries, setEntries] = useState<MongoEntry[]>([]);
  const [active_id, setActiveId] = useState<number | null>(null);
  const next_id = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tables = await listTables(conn_id);
        if (!cancelled) setCollections(tables.map((t) => t.name));
      } catch {
        /* sidebar already reports connection errors */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id]);

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
        if (res.error) flag_error(res.error);
        else {
          if (range) {
            error_ranges.current.delete(id);
            sync_errors();
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
      } finally {
        patch(id, { running: false });
      }
    },
    [patch, conn_id, db, sync_errors, on_modified],
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
  }, [script_text, add_tab, sync_errors]);

  const run_target = useCallback(() => {
    const targets = editorRef.current?.getTargets() ?? [];
    if (targets.length === 0) return;
    error_ranges.current.clear();
    sync_errors();
    for (const t of targets) {
      const cleaned = strip_comments(t.text);
      if (cleaned) add_tab(cleaned, { from: t.from, to: t.to });
    }
  }, [add_tab, sync_errors]);

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
  } = useUnsavedQueryTracking(tab_key, script_text, pick_and_write);

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
        <ResizablePanel defaultSize="38%" minSize="15%" className="flex-col">
          <div className="flex h-full min-h-0 flex-col gap-3">
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
              height="100%"
            />
          </div>
        </ResizablePanel>

        <ResizableHandle className="bg-transparent hover:bg-accent h-1!" />

        <ResizablePanel defaultSize="62%" minSize="25%" className="flex-col border-t">
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
