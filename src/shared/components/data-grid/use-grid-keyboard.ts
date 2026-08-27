import type { KeyboardEvent } from "react";

const cellKey = (r: number, c: string) => `${r}\u0000${c}`;

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
  /** Called after the active cell moves so the grid can scroll it into view. */
  on_navigate?: (r: number, dci: number) => void;
}

/**
 * Handles grid keyboard shortcuts:
 *   - Arrow keys: move the active cell (collapsing the selection to it).
 *   - Shift+Arrow: extend the selection net from the anchor.
 *   - Enter: open the in-place editor for the active cell.
 *   - Esc: dismiss the editor.
 *   - Cmd/Ctrl+C: copy the selected cells as TSV.
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
  on_navigate,
}: UseGridKeyboardArgs) {
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

  const handle_keydown = (e: KeyboardEvent<HTMLDivElement>) => {
    const copy = (e.key === "c" || e.key === "C") && (e.metaKey || e.ctrlKey);
    if (copy) {
      e.preventDefault();
      on_copy();
      return;
    }
    if (e.key === "Escape") {
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
    const dir = DIRS[e.key];
    if (!dir) return;
    e.preventDefault();
    move_cell(dir[0], dir[1], e.shiftKey);
  };

  return handle_keydown;
}
