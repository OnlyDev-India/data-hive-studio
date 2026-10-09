import { createContext, useContext } from "react";
import type { Clause, ClauseKind } from "@/shared/store";
import type { Column } from "./columns";
import type { JoinSuggestion } from "./joins";
import type { NewQueryKind } from "./model";
import type { Dialect } from "./sql-text";
import type { PickTable } from "./use-catalog";

/** What a card, a link or the add button can do to the query. Passed by
 *  context so node data stays plain values. */
export interface ClauseActions {
  /** Change a card's text; `typing` names the field being typed in, so a
   *  run of edits to it is one undo step. Subqueries whose marker left the
   *  text are dropped; each marker in `create` gets a new subquery. */
  patch: (
    id: string,
    text: Partial<Pick<Clause, "body" | "aggregates">>,
    typing?: string,
    create?: number[],
  ) => void;
  /** Commit a card's SQL view text: each subquery in it becomes a chain
   *  again, keeping chain ids by position. One undo step. */
  commitSql: (id: string, text: string) => void;
  /** A free marker for a new subquery in card `id`. */
  newMarker: (id: string) => number;
  /** Collapse or expand a chain; not an undo step. */
  toggleChain: (chain: string) => void;
  setView: (id: string, view: "form" | "sql") => void;
  /** Close the text edit in progress, so the next one is its own undo step. */
  commitText: () => void;
  remove: (id: string) => void;
  select: (id: string) => void;
  /** Add a new `kind` card at `index` in `list`: a query's id, or a
   *  chain's. */
  insert: (list: string, index: number, kind: ClauseKind) => void;
  /** Move JOIN, CTE or set operation card `id` to `slot` among its kind. */
  moveJoin: (id: string, slot: number) => void;
  /** Turn statement query `query` into cards: null when it did, else why
   *  not. */
  convert: (query: string) => string | null;
}

export const ClauseActionsContext = createContext<ClauseActions | null>(null);

export function useClauseActions(): ClauseActions {
  const actions = useContext(ClauseActionsContext);
  if (!actions) throw new Error("useClauseActions outside the query canvas");
  return actions;
}

/** Columns each card can pick from, by card id. */
export const ColumnsContext = createContext<Record<string, Column[]>>({});

const NO_COLUMNS: Column[] = [];

export function useCardColumns(id: string): Column[] {
  return useContext(ColumnsContext)[id] ?? NO_COLUMNS;
}

/** What the table pickers offer. */
export interface Tables {
  dialect: Dialect;
  /** The tab's schema (Postgres), whose tables are written bare. */
  home: string | null;
  tables: PickTable[];
  loadOtherSchemas: () => void;
  /** Foreign key suggestions for JOIN card `id`. */
  suggestions: (id: string) => JoinSuggestion[];
  /** The alias a table needs in JOIN card `id`, if any. */
  aliasFor: (id: string, name: string) => string | null;
  /** The key column sets ON CONFLICT card `id` can match on: its INSERT
   *  target's primary key and unique indexes; undefined while unknown. */
  keysOf: (id: string) => string[][] | undefined;
}

export const TablesContext = createContext<Tables | null>(null);

export function useTables(): Tables {
  const t = useContext(TablesContext);
  if (!t) throw new Error("useTables outside the query canvas");
  return t;
}

/** What a query column's header and the "+ Query" button can do. */
export interface QueryActions {
  /** A header click: only this query, toggle it (Cmd), or the range
   *  (Shift). */
  pick: (id: string, how: "only" | "toggle" | "range") => void;
  /** Null goes back to the auto label. */
  rename: (id: string, name: string | null) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  /** Move query `id` to `slot` in canvas order. */
  move: (id: string, slot: number) => void;
  openSql: (id: string) => void;
  copySql: (id: string) => void;
  run: (id: string) => void;
  add: (kind: NewQueryKind) => void;
}

export const QueryActionsContext = createContext<QueryActions | null>(null);

export function useQueryActions(): QueryActions {
  const actions = useContext(QueryActionsContext);
  if (!actions) throw new Error("useQueryActions outside the query canvas");
  return actions;
}

/** The FROM card whose table picker opens as it appears: a new subquery's
 *  first card. `clear` once it has opened. */
export interface OpenPicker {
  id: string | null;
  clear: () => void;
}

export const OpenPickerContext = createContext<OpenPicker>({
  id: null,
  clear: () => {},
});

export const useOpenPicker = () => useContext(OpenPickerContext);
