import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, TextCursorInput, X } from "lucide-react";
import type { Completion } from "@codemirror/autocomplete";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { cn, statementRanges } from "@/shared/lib/utils";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import {
  SqlEditor,
  type SqlEditorHandle,
} from "@/features/sql-console/editor/sql-editor";
import { QueryResultsGrid } from "@/shared/components/data-grid/query-results-grid";
import {
  runSqlStream,
  tableSchema,
  writeFile,
  type QueryResult,
} from "@/shared/api";
import { pickSqlSavePath } from "@/shared/lib/platform";
import { useStudioStore } from "@/shared/store";

interface SqlTabProps {
  conn_id: string;
  /** Store key — registers the tab's unsaved-query state for the tab strip. */
  tab_key: string;
  tables?: string[];
  on_modified?: () => void;
}

interface ResultTab {
  id: number;
  label: string;
  result: QueryResult | null;
  running: boolean;
}

/** Completion hints shared by EVERY SQL tab in the session, keyed by
 *  `${connId}\u0000${table}` — a second tab (or reopening one) costs zero
 *  table_schema round trips. */
const sharedCompletionCache = new Map<string, Completion[]>();

export function SqlTab({ conn_id, tab_key, tables, on_modified }: SqlTabProps) {
  // Seed text handed over by other features (e.g. "open edits in SQL editor"):
  // openSql(connId, text) stashes it under this tab's key; read it once here.
  // The store entry itself is removed when the tab closes.
  const [sql, setSql] = useState(
    () => useStudioStore.getState().sqlSeeds[tab_key] ?? "",
  );
  const [tabs, setTabs] = useState<ResultTab[]>([]);
  const [active_id, setActiveId] = useState<number | null>(null);
  const editorRef = useRef<SqlEditorHandle>(null);
  const next_id = useRef(0);
  const next_label = useRef(1);

  // Column completions per table for the editor. Fetched once per table
  // Column completions per table for the editor. Fetched once per table
  // (cached across refreshes) whenever the table list changes.
  const [schema, setSchema] = useState<Record<string, Completion[]>>({});
  // Completion hints per `${connId}\u0000${table}`, shared by EVERY SQL tab
  // in the session — a second tab (or reopening one) costs zero describes.
  const schema_cache = useRef(sharedCompletionCache);
  const tables_ref = useRef(tables);
  useEffect(() => {
    tables_ref.current = tables;
  });
  const table_key = useMemo(() => (tables ?? []).join("\u0000"), [tables]);

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
          const cache_key = `${conn_id}\u0000${t}`;
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
          const cols = schema_cache.current.get(`${conn_id}\u0000${t}`);
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

  const add_tab = (): number => {
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
  };

  const patch_tab = (id: number, patch: Partial<ResultTab>) => {
    setTabs((cur) => cur.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const close_tab = (id: number) => {
    setTabs((cur) => {
      const idx = cur.findIndex((t) => t.id === id);
      const nextList = cur.filter((t) => t.id !== id);
      if (active_id === id) {
        const next = nextList[Math.max(0, idx - 1)];
        setActiveId(next ? next.id : null);
      }
      return nextList;
    });
  };

  const run_query = async (id: number, query: string) => {
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
    if (!res.is_select && !res.error) on_modified?.();
    // The resolved metadata is authoritative; pair it with accumulated rows.
    patch_tab(id, {
      running: false,
      result: res.is_select ? { ...res, rows: acc.rows } : res,
    });
  };

  const run_all = () => {
    const stmts = statementRanges(sql)
      .map((r) => sql.slice(r.start, r.end).trim())
      .filter(Boolean);
    if (stmts.length === 0) return;
    for (const stmt of stmts) {
      const id = add_tab();
      void run_query(id, stmt);
    }
  };

  const run_target = () => {
    const target = editorRef.current?.getTarget();
    if (!target) return;
    const id = add_tab();
    void run_query(id, target);
  };

  const active = tabs.find((t) => t.id === active_id) ?? null;

  // ---- Unsaved-query tracking -------------------------------------------
  // Any text in the editor marks the tab dirty (dot in the strip); closing
  // then offers to save the queries to a .sql file.
  const set_sql_tab = useStudioStore((s) => s.setSqlTab);
  const clear_sql_tab = useStudioStore((s) => s.clearSqlTab);
  const sql_ref = useRef(sql);
  useEffect(() => {
    sql_ref.current = sql;
  });
  const save_sql = useCallback(async (): Promise<boolean> => {
    const path = await pickSqlSavePath();
    if (!path) return false;
    const bytes = Array.from(new TextEncoder().encode(sql_ref.current));
    await writeFile(path, bytes);
    return true;
  }, []);
  useEffect(() => {
    set_sql_tab(tab_key, { has_text: sql.trim().length > 0, save: save_sql });
    // Re-registers whenever the dirty flag flips; cleanup on unmount.
    return () => clear_sql_tab(tab_key);
  }, [tab_key, sql, save_sql, set_sql_tab, clear_sql_tab]);
  // ------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical" className="gap-3">
        <ResizablePanel defaultSize="40%" minSize="15%" className="flex-col">
          <div className="flex h-full min-h-0 flex-col gap-3">
            <SqlEditor
              ref={editorRef}
              value={sql}
              onChange={setSql}
              onRun={() => void run_all()}
              onRunTarget={run_target}
              tables={tables}
              schema={schema}
              height="100%"
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button disabled={sql.trim().length === 0} onClick={run_all}>
                <Play className="size-4" />
                Run all
              </Button>
              <Button
                variant="outline"
                onClick={run_target}
                title="Run the selected text, or the statement under the cursor"
              >
                <TextCursorInput className="size-4" />
                Run selection
              </Button>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="60%" minSize="25%" className="flex-col">
          <div className="flex h-full min-h-0 flex-col">
            {tabs.length > 0 && (
              <div className="bg-background flex shrink-0 scrollbar-none items-center gap-0.5 overflow-x-auto border-b px-1.5 pt-1">
                {tabs.map((t) => (
                  <div
                    key={t.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "flex max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-sm whitespace-nowrap select-none",
                      t.id === active_id
                        ? "border-primary text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
                    )}
                  >
                    {t.running ? (
                      <span className="bg-primary size-2 shrink-0 animate-pulse rounded-full" />
                    ) : t.result?.error ? (
                      <span className="bg-destructive size-2 shrink-0 rounded-full" />
                    ) : (
                      <span className="bg-success size-2 shrink-0 rounded-full" />
                    )}
                    <span className="truncate">{t.label}</span>
                    <Button
                      variant="ghost"
                      size="iconXs"
                      className="-mr-1 ml-0.5 size-5 opacity-60 hover:opacity-100"
                      aria-label="Close result tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        close_tab(t.id);
                      }}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-4" data-selectable>
              {active === null ? (
                <div className="text-muted-foreground rounded-md border border-dashed p-10 text-center text-sm">
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
                <SqlResults result={active.result} />
              ) : null}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

function SqlResults({ result }: { result: QueryResult }) {
  const { elapsed_ms } = result;

  if (result.is_select)
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border">
        <QueryResultsGrid result={result} />
        <div className="bg-muted/30 text-muted-foreground flex items-center gap-2 border-t px-3 py-1.5 text-xs">
          <Badge variant="success">Query</Badge>
          <span>
            {result.rows.length} rows • {elapsed_ms} ms
          </span>
        </div>
      </div>
    );

  if (result.error)
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
        {result.error}
      </div>
    );

  return (
    <div className="text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
      <Badge variant="info">Done</Badge>
      <span>
        {result.rows_affected} row(s) affected • {elapsed_ms} ms
      </span>
    </div>
  );
}
