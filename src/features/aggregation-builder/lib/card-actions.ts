import { createContext, useContext } from "react";
import type { AggregationStage } from "@/shared/store";
import type { ChainRef } from "./model";

/** The card fields a toggle changes in one step. */
export type CardFlags = Partial<
  Pick<AggregationStage, "enabled" | "collapsed" | "view">
>;

/** What a card, a link or the add button can do to the pipeline. Passed by
 *  context so node data stays plain values. */
export interface CardActions {
  setBody: (id: string, body: string) => void;
  setOp: (id: string, op: string) => void;
  /** A title or note; null removes it. */
  setText: (id: string, field: "title" | "note", text: string | null) => void;
  setFlags: (id: string, flags: CardFlags) => void;
  /** Close the text edit in progress, so the next one is its own undo step. */
  commitText: () => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  /** Move a card to `index` of its chain without it. */
  move: (id: string, index: number) => void;
  select: (id: string) => void;
  /** Add a new `op` card at `index` of a chain, the main one by default. */
  insert: (index: number, op: string, chain?: ChainRef) => void;
  /** A new output on `$facet` card `parent`. */
  addBranch: (parent: string) => void;
  renameBranch: (parent: string, key: string, next: string) => void;
  removeBranch: (parent: string, key: string) => void;
  /** Turn a `$lookup` card's side chain on or off. */
  setSubPipeline: (parent: string, on: boolean) => void;
}

export const CardActionsContext = createContext<CardActions | null>(null);

export function useCardActions(): CardActions {
  const actions = useContext(CardActionsContext);
  if (!actions) throw new Error("useCardActions outside the pipeline canvas");
  return actions;
}

/** The fields each card can pick from, by card id. */
export const FieldsContext = createContext<Record<string, string[]>>({});

export function useCardFields(id: string): string[] {
  return useContext(FieldsContext)[id] ?? NO_FIELDS;
}

const NO_FIELDS: string[] = [];
