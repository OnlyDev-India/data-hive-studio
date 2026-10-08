import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Play,
  Redo2,
  RefreshCw,
  Square,
  Undo2,
  WifiOff,
} from "lucide-react";
import { format as formatSql } from "sql-formatter";
import { runSqlStream, type QueryChunk } from "@/shared/api";
import {
  BuilderSettings,
  chainFaults,
  hasFault,
  isConnectionLost,
  useBuilderHistory,
  useBuilderRun,
  useUndoKeys,
} from "@/shared/components/builder-canvas";
import {
  DEFAULT_QUERY_BUILDER_SETUP,
  fromClause,
  useStudioStore,
  type Clause,
  type QueryBuilderSetup,
} from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import type { ClauseActions, Tables } from "../lib/card-actions";
import { cardColumns } from "../lib/columns";
import { aliasFor, joinSuggestions } from "../lib/joins";
import { useCatalog } from "../lib/use-catalog";
import {
  cardName,
  findClause,
  insertClause,
  moveJoin,
  newClause,
  patchClause,
  removeClause,
} from "../lib/model";
import type { Dialect } from "../lib/sql-text";
import { useSqlPreviews } from "../lib/use-sql-previews";
import { OutputPanel, type OutputTab } from "./output-panel";
import { PasteDialog } from "./paste-dialog";
import { QueryHeader } from "./query-header";
import { SwitchDialog } from "./switch-dialog";
import { QueryCanvas } from "./query-canvas";

const clausesOf = (s: QueryBuilderSetup) => s.clauses;
const restoreClauses = (
  cur: QueryBuilderSetup,
  clauses: Clause[],
): QueryBuilderSetup => ({
  ...cur,
  clauses,
  selected_clause_id: findClause(clauses, cur.selected_clause_id)
    ? cur.selected_clause_id
    : null,
});

/** A SQL query builder: the query as clause cards on a canvas, each with
 *  the rows after it previewed, and the full result on demand. */
export function QueryBuilderTab({
  conn_id,
  tab_key,
  active,
}: {
  conn_id: string;
  tab_key: string;
  /** The visible tab, the only one that takes Cmd+Z. */
  active: boolean;
}) {
  const stored = useStudioStore((s) => s.queryBuilderTabs[tab_key]);
  const setup = stored ?? DEFAULT_QUERY_BUILDER_SETUP;
  const setSetup = useStudioStore((s) => s.setQueryBuilderSetup);
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const own_database = useStudioStore(
    (s) => s.recentParams[conn_id]?.database ?? conn?.name ?? "",
  );
  const keyword_case = useStudioStore((s) => s.sqlFormatKeywordCase);
  const indent_width = useStudioStore((s) => s.sqlFormatIndentWidth);
  // A restored tab may load before its connection opens; only Postgres
  // tabs keep a schema.
  const dialect: Dialect = conn
    ? conn.kind === "postgres"
      ? "postgresql"
      : "sqlite"
    : setup.schema !== null
      ? "postgresql"
      : "sqlite";

  const readSetup = useCallback(
    () =>
      useStudioStore.getState().queryBuilderTabs[tab_key] ??
      DEFAULT_QUERY_BUILDER_SETUP,
    [tab_key],
  );
  const writeSetup = useCallback(
    (next: QueryBuilderSetup) => setSetup(tab_key, next),
    [setSetup, tab_key],
  );
  const update = useCallback(
    (fn: (cur: QueryBuilderSetup) => QueryBuilderSetup) =>
      writeSetup(fn(readSetup())),
    [readSetup, writeSetup],
  );
  const history = useBuilderHistory({
    tab_key,
    read: readSetup,
    write: writeSetup,
    cardsOf: clausesOf,
    restore: restoreClauses,
  });
  useUndoKeys(active, history.undo, history.redo);

  const previews = useSqlPreviews({ conn_id, dialect, setup });
  const catalog = useCatalog({
    conn_id,
    connected: !!conn,
    dialect,
    database: setup.database,
    schema: setup.schema,
    clauses: setup.clauses,
  });
  const columns = useMemo(
    () => cardColumns(setup.clauses, catalog.columnsOf, dialect),
    [setup.clauses, catalog.columnsOf, dialect],
  );
  const { tables: catalog_tables, loadOtherSchemas, links } = catalog;
  const tables: Tables = useMemo(() => {
    // A JOIN card is suggested against the cards before it.
    const before = (id: string) =>
      setup.clauses.slice(
        0,
        Math.max(
          setup.clauses.findIndex((c) => c.id === id),
          0,
        ),
      );
    return {
      dialect,
      home: setup.schema,
      tables: catalog_tables,
      loadOtherSchemas,
      suggestions: (id) =>
        joinSuggestions(before(id), links, setup.schema, dialect),
      aliasFor: (id, name) => aliasFor(before(id), name, dialect),
    };
  }, [
    setup.clauses,
    setup.schema,
    catalog_tables,
    loadOtherSchemas,
    links,
    dialect,
  ]);
  const { composed } = previews;
  const [panel, setPanel] = useState<OutputTab>("card");
  const [copied, setCopied] = useState(false);

  const launch = useCallback(
    async (run_id: string | null, onChunk: (c: QueryChunk) => void) =>
      runSqlStream(
        conn_id,
        composed.sql ?? "",
        onChunk,
        setup.database ?? undefined,
        setup.schema ?? undefined,
        run_id ?? undefined,
        true,
      ),
    [conn_id, composed.sql, setup.database, setup.schema],
  );
  const { run, start, stop } = useBuilderRun(conn_id, launch);

  const { change, close: commitText } = history;
  const actions: ClauseActions = useMemo(() => {
    return {
      patch: (id, text, typing) =>
        change(
          (s) => ({ ...s, clauses: patchClause(s.clauses, id, text) }),
          typing,
        ),
      setView: (id, view) =>
        update((s) => ({
          ...s,
          clauses: patchClause(s.clauses, id, { view }),
        })),
      commitText,
      remove: (id) =>
        change((s) => restoreClauses(s, removeClause(s.clauses, id))),
      select: (id) => {
        update((s) => ({ ...s, selected_clause_id: id }));
        setPanel("card");
      },
      insert: (index, kind) => {
        const clause = newClause(kind);
        change((s) => ({
          ...s,
          clauses: insertClause(s.clauses, index, clause),
          selected_clause_id: clause.id,
        }));
        setPanel("card");
      },
      moveJoin: (id, slot) =>
        change((s) => ({ ...s, clauses: moveJoin(s.clauses, id, slot) })),
    };
  }, [change, commitText, update]);

  const faults = useMemo(
    () =>
      chainFaults({
        ids: setup.clauses.map((c) => c.id),
        own: (id) => composed.errors.get(id),
        failed: (id) => {
          const p = previews.cards[id];
          return p?.status === "error" && p.chunk?.error
            ? { error: p.chunk.error, timed_out: !!p.chunk.timed_out }
            : null;
        },
        name: cardName,
        skip: (id) => composed.skipped.has(id),
      }),
    [setup.clauses, composed, previews.cards],
  );
  const has_errors = hasFault(faults);
  const ready = !has_errors && !!composed.sql;
  const running = !!run?.running;
  const run_lost = !running && isConnectionLost(run?.error);
  const offline = previews.offline || run_lost;
  const sampled =
    previews.source_rows !== null && previews.source_rows > setup.preview_cap;
  const selected = findClause(setup.clauses, setup.selected_clause_id);
  const selected_index = selected ? setup.clauses.indexOf(selected) : -1;
  const fix_first = "Fix the cards with errors first";

  const output = () => {
    const text = composed.output;
    if (!text) return null;
    try {
      return formatSql(text, {
        language: dialect,
        keywordCase: keyword_case,
        tabWidth: indent_width,
      });
    } catch {
      return text;
    }
  };
  const copy = () => {
    const text = output();
    if (text === null) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const onRun = () => {
    if (!composed.sql) return;
    setPanel("run");
    start(composed.sql);
  };
  const openInEditor = () => {
    const text = output();
    if (text === null) return;
    useStudioStore.getState().openSql(conn_id, text, undefined, undefined, {
      database: setup.database ?? undefined,
      schema: setup.schema ?? undefined,
    });
  };

  // Another database or schema: cards with text ask first, and either way
  // the undo history starts over.
  const [switch_to, setSwitchTo] = useState<{
    database: string | null;
    schema: string | null;
    label: string;
  } | null>(null);
  const [pasting, setPasting] = useState(false);
  const switchTarget = (
    to: { database: string | null; schema: string | null },
    clear: boolean,
  ) => {
    history.reset();
    update((s) => ({
      ...s,
      ...to,
      ...(clear ? { clauses: [fromClause()], selected_clause_id: null } : {}),
    }));
  };
  const pickTarget = (
    to: { database: string | null; schema: string | null },
    label: string,
  ) => {
    if (to.database === setup.database && to.schema === setup.schema) return;
    const filled = setup.clauses.some(
      (c) => c.body.trim() || c.aggregates?.trim(),
    );
    if (filled) setSwitchTo({ ...to, label });
    else switchTarget(to, false);
  };
  // Kept cards read the new database or schema once it changes.
  const target_key = `${setup.database ?? ""}\n${setup.schema ?? ""}`;
  const last_target = useRef(target_key);
  const { refresh } = previews;
  useEffect(() => {
    if (last_target.current === target_key) return;
    last_target.current = target_key;
    if (setup.auto_preview) refresh();
  }, [target_key, setup.auto_preview, refresh]);

  const history_buttons = (
    <>
      <Button
        variant="ghost"
        size="iconXs"
        onClick={history.undo}
        disabled={!history.canUndo}
        aria-label="Undo"
        title="Undo (⌘Z)"
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        onClick={history.redo}
        disabled={!history.canRedo}
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
      >
        <Redo2 className="size-3.5" />
      </Button>
    </>
  );

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Query"
      className="flex flex-wrap items-center justify-end gap-1.5"
    >
      {!setup.auto_preview && (
        <Button
          variant="outline"
          size="sm"
          onClick={previews.refresh}
          disabled={!conn || setup.clauses.length === 0}
        >
          <RefreshCw className="size-3.5" />
          Preview
        </Button>
      )}
      {previews.refreshing && (
        <span
          role="status"
          className="text-muted-foreground text-small flex items-center gap-1.5"
        >
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
          Previewing
        </span>
      )}
      <BuilderSettings
        id={tab_key}
        settings={setup}
        onChange={(patch) => update((s) => ({ ...s, ...patch }))}
        unit="rows"
        source="table"
      />
      <Button
        variant="outline"
        size="sm"
        disabled={!ready}
        title={has_errors ? fix_first : "Copy the formatted query"}
        onClick={copy}
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? "Copied" : "Copy SQL"}
      </Button>
      {running ? (
        <Button
          variant="outline"
          size="sm"
          onClick={stop}
          disabled={!stop || run?.stopping}
        >
          <Square className="size-3.5" />
          {run?.stopping ? "Stopping…" : "Stop"}
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onRun}
          disabled={!conn || !ready || offline}
          title={
            has_errors
              ? fix_first
              : "Run the whole query, read only, with no cap"
          }
        >
          <Play className="size-3.5" />
          Run
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <QueryHeader
        conn_id={conn_id}
        connected={!!conn}
        postgres={dialect === "postgresql"}
        ownDatabase={own_database}
        database={setup.database}
        schema={setup.schema}
        onDatabase={(d) =>
          pickTarget(
            { database: d === own_database ? null : d, schema: setup.schema },
            d,
          )
        }
        onSchema={(schema) =>
          pickTarget({ database: setup.database, schema }, schema)
        }
        onPaste={() => setPasting(true)}
        onOpenSql={openInEditor}
        canOpenSql={ready}
        openSqlTitle={
          has_errors ? fix_first : "Open the query in a new SQL editor tab"
        }
      />
      {offline && (
        <div
          role="status"
          className="bg-muted/60 text-small text-muted-foreground flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        >
          <WifiOff className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Not connected. You can keep editing and copying; previews and Run
            wait for the server.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6"
            disabled={!conn || previews.refreshing}
            onClick={previews.refresh}
          >
            {previews.refreshing ? (
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Reconnect
          </Button>
        </div>
      )}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="canvas" minSize="25%" className="border-b">
          <QueryCanvas
            clauses={setup.clauses}
            selectedId={setup.selected_clause_id}
            previews={previews.cards}
            faults={faults}
            skipped={composed.skipped}
            columns={columns}
            tables={tables}
            cap={setup.preview_cap}
            sampled={sampled}
            dialect={dialect}
            actions={actions}
            toolbar={toolbar}
            history={history_buttons}
          />
        </ResizablePanel>
        <ResizableHandle className="bg-background hover:bg-accent h-1!" />
        <ResizablePanel id="output" defaultSize="35%" minSize="12%">
          <OutputPanel
            conn_id={conn_id}
            tab_key={tab_key}
            database={setup.database ?? undefined}
            tab={panel}
            onTab={setPanel}
            clause={selected}
            ordinal={selected_index + 1}
            preview={selected ? previews.cards[selected.id] : undefined}
            previewSql={
              composed.targets.find((t) => t.clause_id === selected?.id)?.sql ??
              ""
            }
            run={run}
            onStop={stop}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <SwitchDialog
        to={switch_to?.label ?? null}
        onCancel={() => setSwitchTo(null)}
        onKeep={() => {
          if (switch_to) switchTarget(switch_to, false);
          setSwitchTo(null);
        }}
        onClear={() => {
          if (switch_to) switchTarget(switch_to, true);
          setSwitchTo(null);
        }}
      />
      <PasteDialog
        open={pasting}
        onOpenChange={setPasting}
        dialect={dialect}
        onApply={(clauses) =>
          change((s) => ({ ...s, clauses, selected_clause_id: null }))
        }
      />
    </div>
  );
}
