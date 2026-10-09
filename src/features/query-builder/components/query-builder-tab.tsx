import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  ListVideo,
  Loader2,
  Play,
  Redo2,
  RefreshCw,
  Square,
  Undo2,
  WifiOff,
} from "lucide-react";
import { format as formatSql } from "sql-formatter";
import {
  BuilderSettings,
  chainFaults,
  hasFault,
  isConnectionLost,
  useBuilderHistory,
  useUndoKeys,
  type CardFault,
} from "@/shared/components/builder-canvas";
import { useSqlRunGate } from "@/shared/hooks/use-sql-run-gate";
import {
  DEFAULT_QUERY_BUILDER_SETUP,
  selectQuery,
  useStudioStore,
  type BuilderQuery,
  type QueryBuilderSetup,
} from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import {
  OpenPickerContext,
  type ClauseActions,
  type OpenPicker,
  type QueryActions,
  type Tables,
} from "../lib/card-actions";
import {
  keepCollapsed,
  newChain,
  nextMarker,
  outerChains,
  syncChains,
} from "../lib/chains";
import { queryColumns } from "../lib/columns";
import { cardTable, type Composed } from "../lib/compose";
import { markersIn } from "../lib/markers";
import { aliasFor, joinSuggestions } from "../lib/joins";
import { useCatalog } from "../lib/use-catalog";
import {
  allCards,
  allChains,
  cardName,
  currentQuery,
  duplicateQuery,
  findCard,
  insertClause,
  listOf,
  mapChain,
  mapList,
  mapListOf,
  moveJoin,
  moveQuery,
  newClause,
  newQuery,
  patchClause,
  pickedAfterDelete,
  pickQuery,
  queryLabel,
  queryOf,
  queryOfChain,
  removeClause,
  runOrder,
} from "../lib/model";
import { pickedSet, scriptText, sendSet } from "../lib/output";
import { parseBack, rebuildCard } from "../lib/parse-back";
import { openChains, searchQueries } from "../lib/search";
import { readCte } from "../lib/sql-text";
import { useQueryRuns } from "../lib/use-query-runs";
import type { Dialect } from "../lib/sql-text";
import { useSqlPreviews } from "../lib/use-sql-previews";
import { OutputPanel, type OutputTab } from "./output-panel";
import { PasteDialog } from "./paste-dialog";
import { QueryHeader } from "./query-header";
import { SwitchDialog } from "./switch-dialog";
import { QueryCanvas, type CanvasSearch } from "./query-canvas";
import { QuerySearch } from "./query-search";

const queriesOf = (s: QueryBuilderSetup) => s.queries;

/** `s` with the selected card dropped unless it is in the current query. */
function withSelection(s: QueryBuilderSetup): QueryBuilderSetup {
  const cur = currentQuery(s);
  return cur && findCard(cur.clauses, s.selected_clause_id)
    ? s
    : { ...s, selected_clause_id: null };
}

/** Queries put back by undo or redo, keeping only picks that still exist
 *  and every chain collapsed or open as it is now. */
const restoreQueries = (
  cur: QueryBuilderSetup,
  restored: BuilderQuery[],
): QueryBuilderSetup => {
  const now = cur.queries.flatMap((q) => q.clauses);
  const queries = restored.map((q) => ({
    ...q,
    clauses: keepCollapsed(q.clauses, now),
  }));
  const ids = new Set(queries.map((q) => q.id));
  const picked = cur.picked_query_ids.filter((id) => ids.has(id));
  if (picked.length === 0 && queries.length > 0) picked.push(queries[0].id);
  return withSelection({ ...cur, queries, picked_query_ids: picked });
};

/** `fn` applied to the card list holding card `id`, a query's or a
 *  chain's. */
function onCardsOf(
  s: QueryBuilderSetup,
  id: string,
  fn: (clauses: BuilderQuery["clauses"]) => BuilderQuery["clauses"],
): QueryBuilderSetup {
  const q = queryOf(s.queries, id);
  if (!q) return s;
  return {
    ...s,
    queries: s.queries.map((x) =>
      x === q ? { ...x, clauses: mapListOf(x.clauses, id, fn) } : x,
    ),
  };
}

/** A name no CTE in `clauses` has yet: cte, cte_2, … */
function freeCteName(clauses: BuilderQuery["clauses"]): string {
  const taken = new Set(
    clauses.flatMap((c) =>
      c.kind === "cte" ? [readCte(c.body)?.name.toLowerCase() ?? ""] : [],
    ),
  );
  if (!taken.has("cte")) return "cte";
  let n = 2;
  while (taken.has(`cte_${n}`)) n++;
  return `cte_${n}`;
}

/** The FROM card of each chain `next` holds that `prev` did not. */
function newChainFroms(
  prev: BuilderQuery["clauses"],
  next: BuilderQuery["clauses"],
) {
  const had = new Set(allChains(prev).map((ch) => ch.id));
  return allChains(next)
    .filter((ch) => !had.has(ch.id))
    .flatMap((ch) =>
      ch.clauses.filter((c) => c.kind === "from").map((c) => c.id),
    );
}

/** A SQL query builder: queries as columns of clause cards on a canvas.
 *  The current query previews the rows after each card; Run gives the full
 *  result. */
export function QueryBuilderTab({
  conn_id,
  tab_key,
  active,
  on_modified,
  on_schema_modified,
}: {
  conn_id: string;
  tab_key: string;
  /** The visible tab, the only one that takes Cmd+Z. */
  active: boolean;
  /** After a run that wrote: refreshes the sidebar's tables. */
  on_modified?: () => void;
  /** After a run that changed the schema: refreshes open table tabs too. */
  on_schema_modified?: () => void;
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
    cardsOf: queriesOf,
    restore: restoreQueries,
  });
  useUndoKeys(active, history.undo, history.redo);

  const { queries } = setup;
  const current = currentQuery(setup);
  const all_clauses = useMemo(
    () => queries.flatMap((q) => allCards(q.clauses)),
    [queries],
  );
  const catalog = useCatalog({
    conn_id,
    connected: !!conn,
    dialect,
    database: setup.database,
    schema: setup.schema,
    clauses: all_clauses,
  });
  const columns = useMemo(
    () =>
      Object.assign(
        {},
        ...queries.map((q) =>
          queryColumns(q.clauses, catalog.columnsOf, dialect),
        ),
      ) as ReturnType<typeof queryColumns>,
    [queries, catalog.columnsOf, dialect],
  );
  // Chains that read the outer row never preview on their own. Keyed by
  // its ids, so an edit that leaves them alone keeps the same set.
  const outer_key = useMemo(
    () =>
      queries
        .flatMap((q) => [...outerChains(q.clauses, catalog.columnsOf, dialect)])
        .sort()
        .join("\n"),
    [queries, catalog.columnsOf, dialect],
  );
  const outer = useMemo(
    () => new Set(outer_key ? outer_key.split("\n") : []),
    [outer_key],
  );
  const previews = useSqlPreviews({ conn_id, dialect, setup, outer });
  const [open_picker, setOpenPicker] = useState<string | null>(null);
  const picker: OpenPicker = useMemo(
    () => ({ id: open_picker, clear: () => setOpenPicker(null) }),
    [open_picker],
  );
  const { tables: catalog_tables, loadOtherSchemas, links, keysOf } = catalog;
  const tables: Tables = useMemo(() => {
    // A JOIN card is suggested against the cards before it in its list.
    const before = (id: string) => {
      const q = queryOf(queries, id);
      const cards = (q && listOf(q.clauses, id)) ?? [];
      return cards.slice(
        0,
        Math.max(
          cards.findIndex((c) => c.id === id),
          0,
        ),
      );
    };
    return {
      dialect,
      home: setup.schema,
      tables: catalog_tables,
      loadOtherSchemas,
      suggestions: (id) =>
        joinSuggestions(before(id), links, setup.schema, dialect),
      aliasFor: (id, name) => aliasFor(before(id), name, dialect),
      keysOf: (id) => {
        const insert = queryOf(queries, id)?.clauses.find(
          (c) => c.kind === "insert",
        );
        const t = insert && cardTable(insert, dialect);
        return t ? keysOf(t) : undefined;
      },
    };
  }, [
    queries,
    setup.schema,
    catalog_tables,
    loadOtherSchemas,
    links,
    keysOf,
    dialect,
  ]);
  const { composed, composeOf } = previews;
  const composedBy = useMemo(
    () =>
      new Map<string, Composed>(
        queries.map((q) => [
          q.id,
          q.id === current?.id ? composed : composeOf(q.clauses),
        ]),
      ),
    [queries, current?.id, composed, composeOf],
  );
  // Search text lives here only, never in the saved setup.
  const search_box = useRef<HTMLInputElement>(null);
  const [find, setFind] = useState("");
  const [find_at, setFindAt] = useState(-1);
  const [pan, setPan] = useState(0);
  const found = useMemo(
    () => searchQueries(queries, find, dialect),
    [queries, find, dialect],
  );
  const hit_count = found?.hits.length ?? 0;
  const hit_at = hit_count === 0 ? -1 : Math.min(find_at, hit_count - 1);
  const search: CanvasSearch | null = useMemo(
    () =>
      found && {
        dim: found.dim,
        hits: new Set(found.hits),
        focus: hit_at < 0 ? null : found.hits[hit_at],
        nonce: pan,
      },
    [found, hit_at, pan],
  );
  // Collapsed chains holding a match show open, on screen only.
  const shown_queries = useMemo(
    () => (found ? openChains(queries, found.open) : queries),
    [found, queries],
  );
  const findText = (text: string) => {
    setFind(text);
    setFindAt(-1);
  };
  const stepFind = (dir: 1 | -1) => {
    if (hit_count === 0) return;
    setFindAt(
      hit_at < 0
        ? dir > 0
          ? 0
          : hit_count - 1
        : (hit_at + dir + hit_count) % hit_count,
    );
    setPan((n) => n + 1);
  };
  const [panel, setPanel] = useState<OutputTab>("card");
  const [copied, setCopied] = useState(false);
  const gate = useSqlRunGate(conn_id);
  const runner = useQueryRuns(conn_id, {
    database: setup.database,
    schema: setup.schema,
  });

  const { change, close: commitText } = history;
  const actions: ClauseActions = useMemo(() => {
    /** Apply `fn` as one step, opening the FROM picker of a new chain. */
    const changeOpening = (
      fn: (s: QueryBuilderSetup) => QueryBuilderSetup,
      typing?: string,
    ) => {
      let opened: string | null = null;
      change((s) => {
        const next = fn(s);
        const prev = s.queries.flatMap((q) => q.clauses);
        opened =
          newChainFroms(
            prev,
            next.queries.flatMap((q) => q.clauses),
          )[0] ?? null;
        return next;
      }, typing);
      if (opened) setOpenPicker(opened);
    };
    return {
      patch: (id, text, typing, create = []) => {
        // A new subquery is its own undo step.
        if (create.length > 0) commitText();
        changeOpening(
          (s) =>
            onCardsOf(s, id, (cl) =>
              cl.map((c) =>
                c.id === id ? syncChains({ ...c, ...text }, create) : c,
              ),
            ),
          create.length > 0 ? undefined : typing,
        );
      },
      commitSql: (id, text) => {
        const s0 = readSetup();
        const q = queryOf(s0.queries, id);
        const list = q && listOf(q.clauses, id);
        const c = list?.find((x) => x.id === id);
        if (!list || !c) return;
        const taken = new Set(
          list
            .filter((x) => x.id !== id)
            .flatMap((x) => (x.chains ?? []).map((ch) => ch.marker)),
        );
        const rebuilt = rebuildCard(c, text, dialect, taken);
        if (!rebuilt && (c.kind === "cte" || c.kind === "compound")) {
          useStudioStore.getState().pushNotification({
            kind: "error",
            title: "Kept the card as it was",
            detail:
              c.kind === "cte"
                ? "Write it as name AS (SELECT …)."
                : "Write it as UNION, UNION ALL, INTERSECT or EXCEPT, then a SELECT.",
          });
          return;
        }
        // Text the parser can't read is kept as typed, its subqueries
        // inline until it reads again.
        const next = rebuilt ?? { ...c, body: text, chains: undefined };
        if (next.chains === undefined) delete next.chains;
        commitText();
        change((s) =>
          onCardsOf(s, id, (cl) => cl.map((x) => (x.id === id ? next : x))),
        );
      },
      newMarker: (id) => {
        const q = queryOf(readSetup().queries, id);
        const list = (q && listOf(q.clauses, id)) ?? [];
        const used = list.flatMap((c) => markersIn(c.body).map((m) => m.n));
        return Math.max(nextMarker(list), ...used.map((n) => n + 1));
      },
      toggleChain: (chain) =>
        update((s) => {
          const q = queryOfChain(s.queries, chain);
          if (!q) return s;
          return {
            ...s,
            queries: s.queries.map((x) =>
              x === q
                ? {
                    ...x,
                    clauses: mapChain(x.clauses, chain, (ch) => ({
                      ...ch,
                      collapsed: !ch.collapsed,
                    })),
                  }
                : x,
            ),
          };
        }),
      setView: (id, view) =>
        update((s) => onCardsOf(s, id, (cl) => patchClause(cl, id, { view }))),
      commitText,
      remove: (id) =>
        change((s) =>
          withSelection(onCardsOf(s, id, (cl) => removeClause(cl, id))),
        ),
      // A card of another query makes that query current.
      select: (id) => {
        update((s) => {
          const q = queryOf(s.queries, id);
          const picked =
            q && s.picked_query_ids.at(-1) !== q.id
              ? [q.id]
              : s.picked_query_ids;
          return { ...s, selected_clause_id: id, picked_query_ids: picked };
        });
        setPanel("card");
      },
      insert: (list, index, kind) => {
        const s0 = readSetup();
        const q =
          s0.queries.find((x) => x.id === list) ??
          queryOfChain(s0.queries, list);
        if (!q) return;
        const top = q.id === list;
        // A CTE and a set operation come with their one chain.
        const clause =
          kind === "cte"
            ? {
                ...newClause("cte", freeCteName(q.clauses)),
                chains: [newChain(1)],
              }
            : kind === "compound"
              ? { ...newClause("compound", "UNION ALL"), chains: [newChain(1)] }
              : newClause(kind);
        changeOpening((s) => ({
          ...s,
          queries: s.queries.map((x) =>
            x.id === q.id
              ? {
                  ...x,
                  clauses: mapList(x.clauses, top ? null : list, (cl) =>
                    insertClause(cl, index, clause),
                  ),
                }
              : x,
          ),
          picked_query_ids:
            s.picked_query_ids.at(-1) === q.id ? s.picked_query_ids : [q.id],
          selected_clause_id: clause.id,
        }));
        setPanel("card");
      },
      moveJoin: (id, slot) =>
        change((s) => onCardsOf(s, id, (cl) => moveJoin(cl, id, slot))),
      convert: (query) => {
        const q = readSetup().queries.find((x) => x.id === query);
        if (!q || q.kind !== "statement") return null;
        const r = parseBack(q.clauses[0]?.body ?? "", dialect);
        if (!r.ok) return r.error;
        change((s) =>
          withSelection({
            ...s,
            queries: s.queries.map((x) =>
              x.id === query ? { ...x, kind: r.kind, clauses: r.clauses } : x,
            ),
          }),
        );
        return null;
      },
    };
  }, [change, commitText, update, readSetup, dialect]);

  // Each card list's faults in run order: a query's, and each chain's. The
  // SELECT card previews the whole list, so it also waits on any card that
  // fails.
  const { faults, broken } = useMemo(() => {
    const out: Record<string, CardFault> = {};
    const bad = new Set<string>();
    for (const q of queries) {
      const c = composedBy.get(q.id)!;
      const chains = allChains(q.clauses);
      const lists = [q.clauses, ...chains.map((ch) => ch.clauses)];
      // Cards that read the outer row may hold an error from before the
      // catalog said so; they never preview alone.
      const inside = new Set(
        chains
          .filter((ch) => outer.has(ch.id))
          .flatMap((ch) => allCards(ch.clauses).map((x) => x.id)),
      );
      let failing = false;
      for (const list of lists) {
        const run = runOrder(list);
        const ordinal = new Map(list.map((x, i) => [x.id, i]));
        const name = (id: string) => cardName(ordinal.get(id) ?? 0);
        // A card holding a bind variable previews nothing, and every card
        // after it in run order waits on it, the SELECT card too.
        const held = run.findIndex((x) => c.binds.has(x.id));
        const waits = new Set(
          held < 0
            ? []
            : [
                ...run.slice(held + 1).map((x) => x.id),
                ...list.filter((x) => x.kind === "select").map((x) => x.id),
              ].filter((id) => id !== run[held].id),
        );
        const f = chainFaults({
          ids: run.map((x) => x.id),
          own: (id) => c.errors.get(id),
          failed: (id) => {
            if (c.binds.has(id) || waits.has(id) || inside.has(id)) return null;
            const p = previews.cards[id];
            return p?.status === "error" && p.chunk?.error
              ? { error: p.chunk.error, timed_out: !!p.chunk.timed_out }
              : null;
          },
          name: (i) => name(run[i].id),
          skip: (id) => c.skipped.has(id),
        });
        for (const id of waits)
          if (!f[id]) f[id] = { blocked_by: name(run[held].id) };
        const select = list.find((x) => x.kind === "select");
        const fails = run.find((x) => x.kind !== "select" && f[x.id]?.error);
        if (select && fails && !f[select.id])
          f[select.id] = { blocked_by: name(fails.id) };
        if (hasFault(f)) failing = true;
        Object.assign(out, f);
      }
      if (!c.sql || failing) bad.add(q.id);
    }
    return { faults: out, broken: bad };
  }, [queries, composedBy, previews.cards, outer]);
  const skipped = useMemo(
    () => new Set([...composedBy.values()].flatMap((c) => [...c.skipped])),
    [composedBy],
  );
  const binds = useMemo(
    () => new Set([...composedBy.values()].flatMap((c) => [...c.binds])),
    [composedBy],
  );
  const running = runner.running;
  const stopping = Object.values(runner.runs).some((r) => r.stopping);
  // A result tab per run query still on the canvas, named like its header.
  const run_tabs = useMemo(
    () =>
      Object.entries(runner.runs).flatMap(([id, run]) => {
        const q = queries.find((x) => x.id === id);
        return q ? [{ id, run: { ...run, label: queryLabel(q) } }] : [];
      }),
    [runner.runs, queries],
  );
  const run_lost =
    !running &&
    Object.values(runner.runs).some(
      (r) => r.status === "error" && isConnectionLost(r.error),
    );
  const offline = previews.offline || run_lost;
  const sampled =
    previews.source_rows !== null && previews.source_rows > setup.preview_cap;
  const selected = current
    ? findCard(current.clauses, setup.selected_clause_id)
    : null;
  const selected_index =
    selected && current
      ? (listOf(current.clauses, selected.id) ?? []).indexOf(selected)
      : -1;
  // A write query's own cards never preview; its subqueries' cards do.
  const selected_top =
    !!selected && !!current?.clauses.some((c) => c.id === selected.id);
  const fix_first = (q: BuilderQuery) =>
    `Fix the cards with errors in ${queryLabel(q)} first`;

  /** A query as it leaves the builder: SELECT formatted and schema
   *  qualified, a statement as written. */
  const textOf = (q: BuilderQuery) => {
    const text = composedBy.get(q.id)?.output;
    if (!text || q.kind === "statement") return text ?? null;
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
  /** `list` as one script, null while any of them holds a card error. */
  const script = (list: BuilderQuery[]) => {
    if (list.length === 0 || list.some((q) => broken.has(q.id))) return null;
    return scriptText(list.map((q) => ({ name: q.name, text: textOf(q)! })));
  };
  const copy = (list: BuilderQuery[]) => {
    const text = script(list);
    if (text === null) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const openInEditor = (list: BuilderQuery[]) => {
    const text = script(list);
    if (text === null) return;
    useStudioStore.getState().openSql(conn_id, text, undefined, undefined, {
      database: setup.database ?? undefined,
      schema: setup.schema ?? undefined,
    });
  };
  // One after another in canvas order, behind one bind prompt and one
  // confirm. A query with a card error runs nothing.
  const runQueries = async (list: BuilderQuery[]) => {
    if (list.length === 0 || running) return;
    const bad = list.find((q) => broken.has(q.id));
    if (bad) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Nothing ran",
        detail: `${fix_first(bad)}.`,
      });
      return;
    }
    const bound = await gate.gate(
      list.map((q) => composedBy.get(q.id)?.sql ?? ""),
    );
    if (!bound) return;
    setPanel(`run:${list[0].id}`);
    const outcome = await runner.start(
      list.map((q, i) => ({
        id: q.id,
        label: queryLabel(q),
        sql: bound[i],
        read_only: q.kind === "select",
      })),
    );
    if (!outcome.wrote) return;
    on_modified?.();
    if (outcome.ddl) on_schema_modified?.();
    catalog.reload();
    previews.refresh();
  };
  const picked_list = pickedSet(queries, setup.picked_query_ids);
  const send_list = sendSet(queries, setup.picked_query_ids);
  const send_bad = send_list.find((q) => broken.has(q.id));
  const send_what =
    send_list.length < queries.length
      ? `the ${send_list.length} picked queries`
      : queries.length === 1
        ? "the query"
        : `all ${queries.length} queries`;

  const queryActions: QueryActions = {
    pick: (id, how) =>
      update((s) =>
        withSelection({
          ...s,
          picked_query_ids: pickQuery(s.queries, s.picked_query_ids, id, how),
        }),
      ),
    rename: (id, name) =>
      change((s) => ({
        ...s,
        queries: s.queries.map((q) => (q.id === id ? { ...q, name } : q)),
      })),
    duplicate: (id) =>
      change((s) => {
        const at = s.queries.findIndex((q) => q.id === id);
        if (at < 0) return s;
        const copy = duplicateQuery(s.queries[at]);
        return withSelection({
          ...s,
          queries: [
            ...s.queries.slice(0, at + 1),
            copy,
            ...s.queries.slice(at + 1),
          ],
          picked_query_ids: [copy.id],
        });
      }),
    remove: (id) =>
      change((s) =>
        withSelection({
          ...s,
          queries: s.queries.filter((q) => q.id !== id),
          picked_query_ids: pickedAfterDelete(
            s.queries,
            s.picked_query_ids,
            id,
          ),
        }),
      ),
    move: (id, slot) =>
      change((s) => ({ ...s, queries: moveQuery(s.queries, id, slot) })),
    openSql: (id) => openInEditor(queries.filter((q) => q.id === id)),
    copySql: (id) => copy(queries.filter((q) => q.id === id)),
    run: (id) => void runQueries(queries.filter((q) => q.id === id)),
    add: (kind) => {
      const q = newQuery(kind);
      change((s) => ({
        ...s,
        queries: [...s.queries, q],
        picked_query_ids: [q.id],
        selected_clause_id: null,
      }));
    },
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
    const fresh = selectQuery();
    update((s) => ({
      ...s,
      ...to,
      ...(clear
        ? {
            queries: [fresh],
            picked_query_ids: [fresh.id],
            selected_clause_id: null,
          }
        : {}),
    }));
  };
  const pickTarget = (
    to: { database: string | null; schema: string | null },
    label: string,
  ) => {
    if (to.database === setup.database && to.schema === setup.schema) return;
    const filled =
      queries.length > 1 ||
      all_clauses.some((c) => c.body.trim() || c.aggregates?.trim());
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
      <QuerySearch
        inputRef={search_box}
        text={find}
        onText={findText}
        count={hit_count}
        at={hit_at}
        onStep={stepFind}
      />
      {!setup.auto_preview && (
        <Button
          variant="outline"
          size="sm"
          onClick={previews.refresh}
          disabled={!conn || !current}
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
        disabled={send_list.length === 0 || !!send_bad}
        title={send_bad ? fix_first(send_bad) : `Copy ${send_what}`}
        onClick={() => copy(send_list)}
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
          onClick={runner.stop}
          disabled={stopping}
        >
          <Square className="size-3.5" />
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runQueries(queries)}
            disabled={!conn || queries.length < 2 || offline}
            title="Run every query, one after another"
          >
            <ListVideo className="size-3.5" />
            Run all
          </Button>
          <Button
            size="sm"
            onClick={() => void runQueries(picked_list)}
            disabled={!conn || picked_list.length === 0 || offline}
            title={
              picked_list.length > 1
                ? `Run the ${picked_list.length} picked queries, one after another`
                : "Run the current query, with no cap"
            }
          >
            <Play className="size-3.5" />
            Run
          </Button>
        </>
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
        onOpenSql={() => openInEditor(send_list)}
        canOpenSql={send_list.length > 0 && !send_bad}
        openSqlTitle={
          send_bad
            ? fix_first(send_bad)
            : `Open ${send_what} in a new SQL editor tab`
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
          {/* Focusable so a click on the canvas lets it take Cmd+F. A
              card's SQL editor keeps its own. */}
          <div
            tabIndex={-1}
            className="h-full w-full outline-none"
            onKeyDown={(e) => {
              if (
                !(e.metaKey || e.ctrlKey) ||
                e.altKey ||
                e.key.toLowerCase() !== "f" ||
                (e.target as HTMLElement).closest(".cm-editor")
              )
                return;
              e.preventDefault();
              search_box.current?.focus();
              search_box.current?.select();
            }}
          >
            <OpenPickerContext.Provider value={picker}>
              <QueryCanvas
                queries={shown_queries}
                picked={setup.picked_query_ids}
                currentId={current?.id ?? null}
                selectedId={setup.selected_clause_id}
                previews={previews.cards}
                faults={faults}
                skipped={skipped}
                binds={binds}
                broken={broken}
                outer={outer}
                columns={columns}
                tables={tables}
                cap={setup.preview_cap}
                sampled={sampled}
                dialect={dialect}
                actions={actions}
                queryActions={queryActions}
                toolbar={toolbar}
                history={history_buttons}
                search={search}
              />
            </OpenPickerContext.Provider>
          </div>
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
            noPreview={!!current && current.kind !== "select" && selected_top}
            runs={run_tabs}
            onStop={runner.stop}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      {gate.dialogs}
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
        onApply={(added) =>
          change((s) => ({
            ...s,
            queries: [...s.queries, ...added],
            picked_query_ids: [added[0].id],
            selected_clause_id: null,
          }))
        }
      />
    </div>
  );
}
