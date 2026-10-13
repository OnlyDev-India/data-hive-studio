import { useEffect, useMemo, useRef, useState } from "react";
import {
  historyOf,
  record,
  redo,
  setHistory,
  undo,
  EMPTY_HISTORY,
  type History,
} from "./history";

/** How long typing must pause before it counts as one undo step. */
const TEXT_COMMIT_MS = 1000;

/** A builder tab's undo history over its cards `T`, kept in the setup `S`.
 *  Every structural change is one step; a run of typing in one field is one
 *  step, closed on `close` (blur) or after a pause. `restore` puts cards
 *  back into the setup, fixing what points at a card that is gone. */
export function useBuilderHistory<S, T>({
  tab_key,
  read,
  write,
  cardsOf,
  restore,
}: {
  tab_key: string;
  read: () => S;
  write: (s: S) => void;
  cardsOf: (s: S) => T;
  restore: (s: S, cards: T) => S;
}) {
  const [hist, setHist] = useState(() => historyOf<T>(tab_key));
  const burst = useRef<string | null>(null);
  const burst_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = useMemo(() => {
    const save = (h: History<T>) => {
      setHistory(tab_key, h);
      setHist(h);
    };
    const close = () => {
      burst.current = null;
      if (burst_timer.current) clearTimeout(burst_timer.current);
      burst_timer.current = null;
    };
    /** Apply `fn`; `text` names the field being typed in, so a run of
     *  edits to it is one step. */
    const change = (fn: (cur: S) => S, text?: string) => {
      const cur = read();
      const next = fn(cur);
      if (cardsOf(next) !== cardsOf(cur)) {
        if (!text || burst.current !== text) {
          close();
          save(record(historyOf<T>(tab_key), cardsOf(cur)));
        }
        if (text) {
          burst.current = text;
          if (burst_timer.current) clearTimeout(burst_timer.current);
          burst_timer.current = setTimeout(close, TEXT_COMMIT_MS);
        }
      }
      write(next);
    };
    const step = (dir: "undo" | "redo") => {
      close();
      const cur = read();
      const [h, cards] = (dir === "undo" ? undo : redo)(
        historyOf<T>(tab_key),
        cardsOf(cur),
      );
      if (cards === null) return;
      save(h);
      write(restore(cur, cards));
    };
    const reset = () => {
      close();
      save(EMPTY_HISTORY);
    };
    return {
      change,
      close,
      reset,
      undo: () => step("undo"),
      redo: () => step("redo"),
    };
  }, [tab_key, read, write, cardsOf, restore]);

  useEffect(() => api.close, [api]);
  return {
    ...api,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  };
}

/** Cmd+Z and Cmd+Shift+Z on the visible tab. A focused editor, box or
 *  dialog keeps its own undo. */
export function useUndoKeys(
  active: boolean,
  onUndo: () => void,
  onRedo: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z")
        return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          ".cm-editor, input, textarea, select, [contenteditable='true'], [role='dialog']",
        )
      )
        return;
      e.preventDefault();
      if (e.shiftKey) onRedo();
      else onUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onUndo, onRedo]);
}
