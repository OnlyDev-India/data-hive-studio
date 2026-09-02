import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { Loader2, X } from "lucide-react";
import {
  listTables,
  runMongo,
  writeFile,
  type MongoRunResult,
  type QueryResult,
} from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import {
  SqlEditor,
  type SqlEditorHandle,
} from "@/features/sql-console/editor/sql-editor";
import { cn, statementRanges } from "@/shared/lib/utils";
import { QueryResultsGrid } from "@/shared/components/data-grid/query-results-grid";
import { useStudioStore } from "@/shared/store";

const DEFAULT_SCRIPT = ``;

/** One row of the result strip: a single run + its outcome. */
interface Entry {
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
export function MongoConsolePane({
  conn_id,
  tab_key,
  database,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
}) {
  const [db, setDb] = useState(database);
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState<string>("");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active_id, setActiveId] = useState<number | null>(null);
  const editorRef = useRef<SqlEditorHandle>(null);
  const next_id = useRef(0);
  // Grid/JSON is a per-console preference in the action bar's toggle.
  const view = useStudioStore((s) => s.mongoViews[tab_key] ?? "grid");
  const setView = useStudioStore((s) => s.setMongoView);

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

  const patch = useCallback((id: number, p: Partial<Entry>) => {
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...p } : e)));
  }, []);

  const run_query = useCallback(
    async (id: number, text: string) => {
      patch(id, { running: true, result: null });
      try {
        const res = await runMongo(
          conn_id,
          db,
          collection === "" ? null : collection,
          text,
        );
        patch(id, { result: res });
        if (res.switch_db) setDb(res.switch_db);
        // Successful selects show the grid.
        if (res.is_select) setView(tab_key, "grid");
      } catch (e) {
        patch(id, {
          result: {
            command: text,
            columns: [],
            rows: [],
            documents: [],
            rows_affected: 0,
            is_select: false,
            message: null,
            error: String(e),
            switch_db: null,
            elapsed_ms: 0,
          },
        });
      } finally {
        patch(id, { running: false });
      }
    },
    [patch, conn_id, db, collection, tab_key, setView],
  );

  const add_tab = useCallback(
    (text: string) => {
      const id = ++next_id.current;
      setEntries((cur) => [
        ...cur,
        { id, command: text, result: null, running: true },
      ]);
      setActiveId(id);
      void run_query(id, text);
    },
    [run_query],
  );

  const run_all = useCallback(() => {
    const stmts = statementRanges(script)
      .map((r) => strip_comments(script.slice(r.start, r.end)))
      .filter(Boolean);
    if (stmts.length === 0) return;
    // Each statement runs as its own result tab, exactly like the SQL editor.
    for (const stmt of stmts) add_tab(stmt);
  }, [script, add_tab]);

  const run_target = useCallback(() => {
    const target = editorRef.current?.getTarget();
    const cleaned = target ? strip_comments(target) : "";
    if (!cleaned) return;
    add_tab(cleaned);
  }, [add_tab]);

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

  // ---- Unsaved-script tracking + action-bar handle ----------------------
  const save_script = useCallback(async (): Promise<boolean> => {
    const path = await save({
      defaultPath: "console.js",
      filters: [{ name: "JavaScript console", extensions: ["js"] }],
    });
    if (!path || Array.isArray(path)) return false;
    const bytes = Array.from(new TextEncoder().encode(script));
    await writeFile(path, bytes);
    return true;
  }, [script]);
  const set_sql_tab = useStudioStore((s) => s.setSqlTab);
  const clear_sql_tab = useStudioStore((s) => s.clearSqlTab);
  useEffect(() => {
    set_sql_tab(tab_key, {
      has_text: script.trim().length > 0,
      can_run_target: script.trim().length > 0,
      save: save_script,
      run_all,
      run_target,
      mongo_collections: collections,
      mongo_collection: collection,
      set_mongo_collection: setCollection,
    });
    return () => clear_sql_tab(tab_key);
  }, [
    tab_key,
    script,
    save_script,
    run_all,
    run_target,
    collections,
    collection,
    set_sql_tab,
    clear_sql_tab,
  ]);
  // ------------------------------------------------------------------------

  const entry_query_result = (e: Entry): QueryResult => {
    const r = e.result!;
    return {
      columns: r.columns,
      rows: r.rows,
      rows_affected: r.rows_affected,
      is_select: r.is_select,
      error: r.error,
      elapsed_ms: r.elapsed_ms,
    };
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResizablePanelGroup orientation="vertical">
        <ResizablePanel
          defaultSize="38%"
          minSize="15%"
          className="flex-col pb-3"
        >
          <div className="flex h-full min-h-0 flex-col gap-3">
            <SqlEditor
              ref={editorRef}
              value={script}
              onChange={setScript}
              onRun={() => void run_all()}
              onRunTarget={run_target}
              language="js"
              jsCompletions={collections}
              height="100%"
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="62%" minSize="25%" className="flex-col">
          <div className="flex h-full min-h-0 flex-col">
            {entries.length > 0 && (
              <div className="bg-background flex shrink-0 scrollbar-none items-center gap-0.5 overflow-x-auto border-b px-1.5 pt-1">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveId(entry.id)}
                    className={cn(
                      "flex max-w-56 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2.5 py-1.5 text-sm whitespace-nowrap select-none",
                      entry.id === active_id
                        ? "border-primary text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
                    )}
                  >
                    {entry.running ? (
                      <span className="bg-primary size-2 shrink-0 animate-pulse rounded-full" />
                    ) : entry.result?.error ? (
                      <span className="bg-destructive size-2 shrink-0 rounded-full" />
                    ) : (
                      <span className="bg-success size-2 shrink-0 rounded-full" />
                    )}
                    <span className="truncate">
                      {entry.command.split("\n")[0].slice(0, 40)}
                    </span>
                    <Button
                      variant="ghost"
                      size="iconXs"
                      className="-mr-1 ml-0.5 size-5 opacity-60 hover:opacity-100"
                      aria-label="Close result tab"
                      onClick={(e) => {
                        e.stopPropagation();
                        close_tab(entry.id);
                      }}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto p-3" data-selectable>
              {!active ? (
                <div className="text-muted-foreground rounded-md border border-dashed p-10 text-center text-sm">
                  Run a command to see results. Each run opens its own result
                  tab.
                </div>
              ) : active.running ? (
                <div className="flex h-full min-h-0 items-center justify-center p-3">
                  <Loader2 className="text-muted-foreground size-5 animate-spin" />
                </div>
              ) : active.result ? (
                <ResultBody
                  entry={active}
                  query_result={entry_query_result(active)}
                  view={view}
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

function ResultBody({
  entry,
  query_result,
  view,
  conn_id,
  tab_key,
}: {
  entry: Entry;
  query_result: QueryResult;
  view: "grid" | "json";
  conn_id: string;
  tab_key: string;
}) {
  const result = entry.result!;
  if (result.error)
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm whitespace-pre-wrap">
        {result.error}
      </div>
    );
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {result.message && (
        <span className="text-muted-foreground shrink-0 px-1 text-xs">
          {result.message}
        </span>
      )}

      {view === "grid" ? (
        <QueryResultsGrid
          result={query_result}
          conn_id={conn_id}
          tab_key={tab_key}
        />
      ) : result.documents.length === 0 ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
          No documents.
        </div>
      ) : (
        <div className="bg-background min-h-0 flex-1 overflow-auto rounded-md border p-2">
          {result.documents.map((doc, i) => (
            <pre
              key={i}
              className="border-muted rounded-md border-b p-2 font-mono text-xs whitespace-pre-wrap last:border-0"
            >
              {JSON.stringify(doc, null, 2)}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
