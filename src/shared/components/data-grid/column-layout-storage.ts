/** Persisted column layout for one table/collection — drag-reorder, widths,
 *  pinned/hidden sets, and sort — scoped by connection+database+schema+table
 *  so the same table name in a different database never shares a layout.
 *  Mirrors dbx's `dataGridColumnLayoutStorage.ts` shape (versioned, one
 *  localStorage entry per table) rather than a single blob for every table,
 *  so evicting/inspecting one table's layout doesn't touch any other's.
 *
 *  Deliberately NOT included here: filters/custom_where. Those are owned by
 *  the pane (`table-pane.tsx`/`mongo-collection-pane.tsx`), not this grid's
 *  own controller — persisting them means those panes reading/writing this
 *  same storage key too, which is a bigger, separate change. Add it if
 *  losing filters on tab-close turns out to matter in practice. */

export interface ColumnLayout {
  version: 1;
  /** Full column-name permutation from drag-reorder; `null` = natural
   *  (unreordered) DB order. */
  column_order: string[] | null;
  col_widths: Record<string, number>;
  pinned: string[];
  hidden: string[];
  sort_col: string | null;
  sort_asc: boolean;
}

const STORAGE_PREFIX = "dh-studio:grid-layout:";

/** `undefined`/`null` key (e.g. a one-off query result with no stable table
 *  identity) means "don't persist" — every function here is a no-op then. */
export function loadColumnLayout(
  key: string | null | undefined,
): ColumnLayout | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== 1
    ) {
      return null;
    }
    return parsed as ColumnLayout;
  } catch {
    return null;
  }
}

export function saveColumnLayout(
  key: string | null | undefined,
  layout: ColumnLayout,
): void {
  if (!key) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(layout));
  } catch {
    // Storage full/unavailable/private-mode — losing layout persistence
    // isn't worth surfacing an error over.
  }
}
