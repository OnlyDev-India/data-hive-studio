/** One property row in the "Table properties" panel — table rename and
 *  primary key change both use this shape (a label plus before/after);
 *  both are at most one row and always an alter, never an insert or
 *  delete. */
export interface DdlPropertyRow {
  id: string;
  label: string;
  before?: string;
  after?: string;
}

/** One column change, decomposed into real fields (unlike the other DDL
 *  entities below) since columns are the highest volume DDL entity and the
 *  one whose sub-fields are most useful to see separately. An "update" row
 *  renders as a red row directly above a green row, matching `RowDiffGrid`'s
 *  own update pattern. */
export interface DdlColumnRow {
  id: string;
  kind: "insert" | "update" | "delete";
  before?: { name: string; type: string; nullable: boolean; default: string };
  after?: { name: string; type: string; nullable: boolean; default: string };
}

/** One index or foreign key change — still one opaque definition line (the
 *  existing `idx_line(...)`/foreign key line text), just shown as a
 *  Name+Definition grid row instead of a text hunk. */
export interface DdlNamedRow {
  id: string;
  kind: "insert" | "update" | "delete";
  name: string;
  before?: string;
  after?: string;
}

/** One trigger change — the full SQL body, rendered as a full width colored
 *  row rather than squeezed into a normal cell. */
export interface DdlTriggerRow {
  id: string;
  kind: "insert" | "update" | "delete";
  name: string;
  before?: string;
  after?: string;
}

/** One entity-typed section of a DDL review (schema designer / Mongo schema
 *  editor). A section only exists in the array when that entity type
 *  actually changed — no empty sections. Table rename and primary key
 *  change render together as one "Table properties" panel in `DdlDiffGrid`
 *  even though they're separate section entries here. */
export type DdlDiffSection =
  | { entity: "table" | "primary key"; rows: DdlPropertyRow[] }
  | { entity: "column"; rows: DdlColumnRow[] }
  | { entity: "index" | "foreign key"; rows: DdlNamedRow[] }
  | { entity: "trigger"; rows: DdlTriggerRow[] };

/** One row for `RowDiffGrid`. An insert shows `after`, a delete `before`,
 *  an update both (red above green). On an update, `changed` names the
 *  cells to mark; without it, a cell is marked when its column is a key
 *  of `before`/`after` (the review dialog only carries touched columns). */
export interface DiffGridRow {
  id: string;
  kind: "insert" | "update" | "delete";
  /** Gutter text: a row number, or a key. */
  label?: string;
  before?: Record<string, string | null>;
  after?: Record<string, string | null>;
  changed?: string[];
}

/** A per row action in `RowDiffGrid`'s gutter menu. */
export interface DiffRowAction {
  label: string;
  run: () => void;
}
