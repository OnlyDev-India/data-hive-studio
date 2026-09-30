import type { FieldShape, TableSchema } from "@/shared/api";
import type {
  DdlColumnRow,
  DdlDiffSection,
} from "@/shared/components/diff-grid";
import { drafts_toward, structure_diff } from "./drafts-toward";

interface FlatField {
  path: string;
  types: string;
  optional: boolean;
}

function types_of(f: FieldShape): string {
  return f.type === "array" && f.element_types?.length
    ? `array<${f.element_types.join(" | ")}>`
    : f.type;
}

/** Every path in a sampled field tree, as dotted paths (`address.city`). */
export function flatten_fields(fields: FieldShape[]): FlatField[] {
  const out: FlatField[] = [];
  const walk = (list: FieldShape[]) => {
    for (const f of list) {
      out.push({ path: f.path, types: types_of(f), optional: f.optional });
      if (f.children) walk(f.children);
    }
  };
  walk(fields);
  return out;
}

const row_value = (f: FlatField) => ({
  name: f.path,
  type: f.types,
  nullable: f.optional,
  default: "",
});

/** The collection structure diff, read as what would change on the right
 *  to match the left: field paths by name, then indexes by definition. */
export function mongo_structure_diff(
  right_table: string,
  right: { fields: FieldShape[]; schema: TableSchema },
  left: { fields: FieldShape[]; schema: TableSchema },
): DdlDiffSection[] {
  const l = new Map(flatten_fields(left.fields).map((f) => [f.path, f]));
  const r = new Map(flatten_fields(right.fields).map((f) => [f.path, f]));
  const rows: DdlColumnRow[] = [];
  for (const [path, f] of r) {
    if (!l.has(path))
      rows.push({ id: `d:${path}`, kind: "delete", before: row_value(f) });
  }
  for (const [path, f] of l) {
    if (!r.has(path))
      rows.push({ id: `i:${path}`, kind: "insert", after: row_value(f) });
  }
  for (const [path, f] of l) {
    const g = r.get(path);
    if (g && (g.types !== f.types || g.optional !== f.optional))
      rows.push({
        id: `u:${path}`,
        kind: "update",
        before: row_value(g),
        after: row_value(f),
      });
  }

  const indexes_only = (s: TableSchema): TableSchema => ({
    ...s,
    columns: [],
    foreign_keys: [],
    triggers: [],
  });
  const index_sections = structure_diff(
    drafts_toward(
      right_table,
      indexes_only(right.schema),
      indexes_only(left.schema),
    ),
  ).filter((s) => s.entity === "index");

  return [
    ...(rows.length ? [{ entity: "column" as const, rows }] : []),
    ...index_sections,
  ];
}
