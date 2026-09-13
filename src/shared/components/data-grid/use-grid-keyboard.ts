import type { KeyboardEvent } from "react";
import { cellKey } from "./grid-context";

const DIRS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

export interface UseGridKeyboardArgs {
  /** Number of rows in the current page. */
  rows: number;
  /** Display order of columns: (name, result-column-index). */
  col_meta: [string, number][];
  /** Column name -> display index. */
  col_index_of: Record<string, number>;
  active_cell: [number, string] | null;
  sel_anchor: [number, string] | null;
  editable: boolean;
  on_select: (sel: Set<string>) => void;
  on_sel_anchor: (a: [number, string] | null) => void;
  on_active_cell: (a: [number, string] | null) => void;
  on_editing: (a: [number, string] | null) => void;
  /** Copy the current selection as TSV. */
  on_copy: () => void;
  /** Paste clipboard text starting at the active cell (or filling the whole
   *  selection, for a single copied value) — absent when the grid is
   *  read-only. */
  on_paste?: () => void;
  /** Clear (buffer a NULL/empty write for) every selected cell — absent
   *  when the grid is read-only. */
  on_clear_selection?: () => void;
  /** Opens the in-grid find bar (Ctrl/Cmd+F). */
  on_search_open?: () => void;
  /** True while the find bar is open — Escape closes it first, before
   *  falling through to the editor-close behavior below. */
  search_open?: boolean;
  on_search_close?: () => void;
  /** Called after the active cell moves so the grid can scroll it into view. */
  on_navigate?: (r: number, dci: number) => void;
  /** Row step for Page Up/Down — the row-window's own visible row count, so
   *  the jump matches what's actually on screen rather than a fixed guess. */
  page_size?: number;
}

/**
 * Handles grid keyboard shortcuts:
 *   - Arrow keys: move the active cell (collapsing the selection to it).
 *   - Shift+Arrow: extend the selection net from the anchor.
 *   - Tab/Shift+Tab: move right/left, wrapping to the next/previous row.
 *   - Home/End: jump to the first/last column of the current row;
 *     Cmd/Ctrl+Home/End: jump to the first/last cell of the whole page.
 *   - Page Up/Down: move by a viewport's worth of rows.
 *   - Enter: open the in-place editor for the active cell.
 *   - Esc: dismiss the editor.
 *   - Delete/Backspace: clear the selected cells.
 *   - Cmd/Ctrl+C/V: copy/paste the selected cells as TSV.
 */
export function useGridKeyboard({
  rows,
  col_meta,
  col_index_of,
  active_cell,
  sel_anchor,
  editable,
  on_select,
  on_sel_anchor,
  on_active_cell,
  on_editing,
  on_copy,
  on_paste,
  on_clear_selection,
  on_search_open,
  search_open,
  on_search_close,
  on_navigate,
  page_size = 10,
}: UseGridKeyboardArgs) {
  // Shared by every navigation key: given an absolute target cell, either
  // collapse the selection to it or extend the net from the anchor.
  const goto = (nr: number, nci: number, extend: boolean) => {
    const start = active_cell ?? sel_anchor;
    if (!start) return;
    const [r, col] = start;
    const ncol = col_meta[nci][0];

    if (extend) {
      const [ar, ac] = sel_anchor ?? (start as [number, string]);
      const ai = col_index_of[ac] ?? 0;
      const [rlo, rhi] = [Math.min(ar, nr), Math.max(ar, nr)];
      const [clo, chi] = [Math.min(ai, nci), Math.max(ai, nci)];
      const ns = new Set<string>();
      for (let rr = rlo; rr <= rhi; rr++)
        for (let cc = clo; cc <= chi; cc++)
          ns.add(cellKey(rr, col_meta[cc][0]));
      on_select(ns);
      if (!sel_anchor) on_sel_anchor([r, col]);
    } else {
      on_select(new Set([cellKey(nr, ncol)]));
      on_sel_anchor([nr, ncol]);
    }
    on_active_cell([nr, ncol]);
    on_navigate?.(nr, nci);
  };

  const move_cell = (dr: number, dc: number, extend: boolean) => {
    if (rows === 0) return;
    const start = active_cell ?? sel_anchor;
    if (!start) return;
    const [r, col] = start;
    const ci = col_index_of[col] ?? 0;
    const max_r = rows - 1;
    const max_ci = col_meta.length - 1;
    const nr = Math.max(0, Math.min(max_r, r + dr));
    const nci = Math.max(0, Math.min(max_ci, ci + dc));
    goto(nr, nci, extend);
  };

  // Tab wraps to the next/previous row's first/last column instead of
  // clamping at the row's edge — spreadsheet convention, and what makes Tab
  // useful for walking across then down a whole table.
  const tab_cell = (forward: boolean) => {
    if (rows === 0) return;
    const start = active_cell ?? sel_anchor;
    if (!start) return;
    const [r, col] = start;
    const ci = col_index_of[col] ?? 0;
    const max_r = rows - 1;
    const max_ci = col_meta.length - 1;
    let nr = r;
    let nci = ci + (forward ? 1 : -1);
    if (nci > max_ci) {
      nci = 0;
      nr = Math.min(max_r, r + 1);
    } else if (nci < 0) {
      nci = max_ci;
      nr = Math.max(0, r - 1);
    }
    goto(nr, nci, false);
  };

  const home_end = (end: boolean, whole_page: boolean, extend: boolean) => {
    if (rows === 0) return;
    const start = active_cell ?? sel_anchor;
    if (!start) return;
    const [r] = start;
    const max_r = rows - 1;
    const max_ci = col_meta.length - 1;
    const nr = whole_page ? (end ? max_r : 0) : r;
    const nci = end ? max_ci : 0;
    goto(nr, nci, extend);
  };

  const handle_keydown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      on_copy();
      return;
    }
    if (mod && (e.key === "v" || e.key === "V")) {
      if (!on_paste) return;
      e.preventDefault();
      on_paste();
      return;
    }
    if (mod && (e.key === "f" || e.key === "F")) {
      if (!on_search_open) return;
      e.preventDefault();
      on_search_open();
      return;
    }
    if (e.key === "Escape") {
      if (search_open && on_search_close) {
        on_search_close();
        return;
      }
      on_editing(null);
      return;
    }
    if (e.key === "Enter") {
      if (editable && active_cell) {
        e.preventDefault();
        on_editing(active_cell);
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!on_clear_selection) return;
      e.preventDefault();
      on_clear_selection();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      tab_cell(!e.shiftKey);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      home_end(e.key === "End", mod, e.shiftKey);
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      move_cell(e.key === "PageDown" ? page_size : -page_size, 0, e.shiftKey);
      return;
    }
    const dir = DIRS[e.key];
    if (!dir) return;
    e.preventDefault();
    move_cell(dir[0], dir[1], e.shiftKey);
  };

  return handle_keydown;
}
