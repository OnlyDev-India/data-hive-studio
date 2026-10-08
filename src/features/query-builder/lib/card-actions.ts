import { createContext, useContext } from "react";
import type { Clause, ClauseKind } from "@/shared/store";
import type { Column } from "./columns";
import type { JoinSuggestion } from "./joins";
import type { Dialect } from "./sql-text";
import type { PickTable } from "./use-catalog";

/** What a card, a link or the add button can do to the query. Passed by
 *  context so node data stays plain values. */
export interface ClauseActions {
  /** Change a card's text; `typing` names the field being typed in, so a
   *  run of edits to it is one undo step. */
  patch: (
    id: string,
    text: Partial<Pick<Clause, "body" | "aggregates">>,
    typing?: string,
  ) => void;
  setView: (id: string, view: "form" | "sql") => void;
  /** Close the text edit in progress, so the next one is its own undo step. */
  commitText: () => void;
  remove: (id: string) => void;
  select: (id: string) => void;
  /** Add a new `kind` card at `index`. */
  insert: (index: number, kind: ClauseKind) => void;
  /** Move JOIN `id` to `slot` among the JOIN cards. */
  moveJoin: (id: string, slot: number) => void;
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
}

export const TablesContext = createContext<Tables | null>(null);

export function useTables(): Tables {
  const t = useContext(TablesContext);
  if (!t) throw new Error("useTables outside the query canvas");
  return t;
}
