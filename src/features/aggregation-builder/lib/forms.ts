import {
  fieldOf,
  intOf,
  isDoc,
  lastSegment,
  literalOf,
  long,
  parseLiteral,
  splitList,
  type Parsed,
} from "./scalar";

/** What a stage form edits. Each form reads its stage value into one of
 *  these and writes it back; a value the form cannot show reads as null and
 *  the card stays in JSON. */

export const MATCH_OPS = [
  "=",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$regex",
] as const;
export type MatchOp = (typeof MATCH_OPS)[number];

export const ACCUMULATORS = [
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$first",
  "$last",
  "$push",
  "$addToSet",
  "$count",
] as const;
export type Accumulator = (typeof ACCUMULATORS)[number];

export interface MatchRow {
  field: string;
  op: MatchOp;
  value: string;
}
export interface ProjectRow {
  field: string;
  mode: "include" | "exclude" | "from";
  /** The source field when `mode` is "from". */
  value: string;
}
export interface SortRow {
  field: string;
  dir: 1 | -1;
}
export interface GroupKey {
  /** The output name; empty for a single key grouped as `"$field"`. */
  name: string;
  field: string;
}
export interface GroupRow {
  name: string;
  acc: Accumulator;
  /** `$field`, or a literal such as `1`. */
  arg: string;
}

export type FormModel =
  | { op: "$match"; rows: MatchRow[] }
  | { op: "$project"; rows: ProjectRow[] }
  | { op: "$sort"; rows: SortRow[] }
  | { op: "$limit" | "$skip"; n: string }
  | { op: "$group"; keys: GroupKey[]; rows: GroupRow[] }
  | {
      op: "$lookup";
      from: string;
      localField: string;
      foreignField: string;
      as: string;
    }
  | {
      op: "$unwind";
      path: string;
      includeArrayIndex: string;
      preserve: boolean;
    };

export const FORM_OPS = new Set([
  "$match",
  "$project",
  "$sort",
  "$limit",
  "$skip",
  "$group",
  "$lookup",
  "$unwind",
]);

export function hasForm(op: string): boolean {
  return FORM_OPS.has(op);
}

const MATCH_OP_SET = new Set<string>(MATCH_OPS);
const ACC_SET = new Set<string>(ACCUMULATORS);

/** A stage value as its form, or null when the form cannot hold it. */
export function decodeForm(op: string, v: unknown): FormModel | null {
  switch (op) {
    case "$match":
      return decodeMatch(v);
    case "$project":
      return decodeProject(v);
    case "$sort":
      return decodeSort(v);
    case "$limit":
    case "$skip": {
      const n = intOf(v);
      return n === null || typeof v === "boolean" ? null : { op, n: String(n) };
    }
    case "$group":
      return decodeGroup(v);
    case "$lookup":
      return decodeLookup(v);
    case "$unwind":
      return decodeUnwind(v);
    default:
      return null;
  }
}

function decodeMatch(v: unknown): FormModel | null {
  if (!isDoc(v)) return null;
  const rows: MatchRow[] = [];
  for (const [field, w] of Object.entries(v)) {
    if (field.startsWith("$")) return null;
    const lit = literalOf(w);
    if (lit !== null) {
      rows.push({ field, op: "=", value: lit });
      continue;
    }
    if (!isDoc(w)) return null;
    const ops = Object.entries(w);
    if (ops.length === 0) return null;
    for (const [k, x] of ops) {
      const row = matchRow(field, k, x, w);
      if (!row) return null;
      if (row !== "skip") rows.push(row);
    }
  }
  return { op: "$match", rows };
}

function matchRow(
  field: string,
  k: string,
  x: unknown,
  all: Record<string, unknown>,
): MatchRow | "skip" | null {
  if (k === "$eq") {
    const lit = literalOf(x);
    return lit === null ? null : { field, op: "=", value: lit };
  }
  if (k === "$options") return typeof all.$regex === "string" ? "skip" : null;
  if (!MATCH_OP_SET.has(k)) return null;
  const op = k as MatchOp;
  if (op === "$in" || op === "$nin") {
    if (!Array.isArray(x)) return null;
    const items = x.map(literalOf);
    if (items.some((i) => i === null)) return null;
    return { field, op, value: items.join(", ") };
  }
  if (op === "$exists") {
    const on = intOf(x);
    return on === null ? null : { field, op, value: on ? "true" : "false" };
  }
  if (op === "$regex") {
    if (typeof x !== "string" || "$options" in all) return null;
    return { field, op, value: x };
  }
  const lit = literalOf(x);
  return lit === null ? null : { field, op, value: lit };
}

function decodeProject(v: unknown): FormModel | null {
  if (!isDoc(v)) return null;
  const rows: ProjectRow[] = [];
  for (const [field, w] of Object.entries(v)) {
    const from = fieldOf(w);
    if (from !== null) {
      rows.push({ field, mode: "from", value: from });
      continue;
    }
    const n = intOf(w);
    if (n === null || (n !== 0 && n !== 1)) return null;
    rows.push({ field, mode: n ? "include" : "exclude", value: "" });
  }
  return { op: "$project", rows };
}

function decodeSort(v: unknown): FormModel | null {
  if (!isDoc(v)) return null;
  const rows: SortRow[] = [];
  for (const [field, w] of Object.entries(v)) {
    const n = intOf(w);
    if (n !== 1 && n !== -1) return null;
    rows.push({ field, dir: n });
  }
  return { op: "$sort", rows };
}

function decodeGroup(v: unknown): FormModel | null {
  if (!isDoc(v) || !("_id" in v)) return null;
  const id = v._id;
  const single = fieldOf(id);
  let keys: GroupKey[];
  if (id === null) keys = [];
  else if (single !== null) keys = [{ name: "", field: single }];
  else if (isDoc(id)) {
    keys = [];
    for (const [name, w] of Object.entries(id)) {
      const f = fieldOf(w);
      if (f === null) return null;
      keys.push({ name, field: f });
    }
  } else return null;

  const rows: GroupRow[] = [];
  for (const [name, w] of Object.entries(v)) {
    if (name === "_id") continue;
    if (!isDoc(w)) return null;
    const entries = Object.entries(w);
    if (entries.length !== 1) return null;
    const [acc, x] = entries[0];
    if (!ACC_SET.has(acc)) return null;
    if (acc === "$count") {
      if (!isDoc(x) || Object.keys(x).length) return null;
      rows.push({ name, acc: "$count", arg: "" });
      continue;
    }
    const f = fieldOf(x);
    const arg = f !== null ? `$${f}` : literalOf(x);
    if (arg === null) return null;
    rows.push({ name, acc: acc as Accumulator, arg });
  }
  return { op: "$group", keys, rows };
}

function decodeLookup(v: unknown): FormModel | null {
  if (!isDoc(v)) return null;
  const want = ["from", "localField", "foreignField", "as"];
  const keys = Object.keys(v);
  if (keys.some((k) => !want.includes(k))) return null;
  if (keys.some((k) => typeof v[k] !== "string")) return null;
  const s = (k: string) => (v[k] as string | undefined) ?? "";
  return {
    op: "$lookup",
    from: s("from"),
    localField: s("localField"),
    foreignField: s("foreignField"),
    as: s("as"),
  };
}

function decodeUnwind(v: unknown): FormModel | null {
  const path = fieldOf(v);
  if (path !== null)
    return { op: "$unwind", path, includeArrayIndex: "", preserve: false };
  if (!isDoc(v)) return null;
  const allowed = ["path", "includeArrayIndex", "preserveNullAndEmptyArrays"];
  if (Object.keys(v).some((k) => !allowed.includes(k))) return null;
  const p = fieldOf(v.path);
  const idx = v.includeArrayIndex ?? "";
  const keep = v.preserveNullAndEmptyArrays ?? false;
  if (p === null || typeof idx !== "string" || typeof keep !== "boolean")
    return null;
  return { op: "$unwind", path: p, includeArrayIndex: idx, preserve: keep };
}

/** A form as its stage value. Rows with no field yet are left out, so a
 *  half filled row never breaks the card. */
export function encodeForm(m: FormModel): Parsed {
  switch (m.op) {
    case "$match":
      return encodeMatch(m.rows);
    case "$project": {
      const out: Record<string, unknown> = {};
      for (const r of m.rows) {
        const f = r.field.trim();
        if (!f) continue;
        if (r.mode === "from") {
          const src = r.value.trim().replace(/^\$/, "");
          if (!src)
            return { ok: false, error: `Pick the field ${f} comes from` };
          out[f] = `$${src}`;
        } else out[f] = long(r.mode === "include" ? 1 : 0);
      }
      return { ok: true, value: out };
    }
    case "$sort": {
      const out: Record<string, unknown> = {};
      for (const r of m.rows)
        if (r.field.trim()) out[r.field.trim()] = long(r.dir);
      return { ok: true, value: out };
    }
    case "$limit":
    case "$skip":
      return /^\d+$/.test(m.n.trim())
        ? { ok: true, value: long(m.n.trim()) }
        : { ok: false, error: "A whole number, 0 or more" };
    case "$group":
      return encodeGroup(m.keys, m.rows);
    case "$lookup": {
      // Join fields are optional once a sub pipeline does the join.
      const local = m.localField.trim();
      const foreign = m.foreignField.trim();
      return {
        ok: true,
        value: {
          from: m.from.trim(),
          ...(local ? { localField: local } : {}),
          ...(foreign ? { foreignField: foreign } : {}),
          as: m.as.trim(),
        },
      };
    }
    case "$unwind": {
      const path = `$${m.path.trim().replace(/^\$/, "")}`;
      const idx = m.includeArrayIndex.trim();
      if (!idx && !m.preserve) return { ok: true, value: path };
      return {
        ok: true,
        value: {
          path,
          ...(idx ? { includeArrayIndex: idx } : {}),
          ...(m.preserve ? { preserveNullAndEmptyArrays: true } : {}),
        },
      };
    }
  }
}

function encodeMatch(rows: MatchRow[]): Parsed {
  const out: Record<string, unknown> = {};
  const groups = new Map<string, MatchRow[]>();
  for (const r of rows) {
    const f = r.field.trim();
    if (!f) continue;
    groups.set(f, [...(groups.get(f) ?? []), r]);
  }
  for (const [field, list] of groups) {
    if (list.length === 1 && list[0].op === "=") {
      const p = parseLiteral(list[0].value);
      if (!p.ok) return p;
      out[field] = p.value;
      continue;
    }
    const ops: Record<string, unknown> = {};
    for (const r of list) {
      const p = matchValue(r);
      if (!p.ok) return p;
      ops[r.op === "=" ? "$eq" : r.op] = p.value;
    }
    out[field] = ops;
  }
  return { ok: true, value: out };
}

function matchValue(r: MatchRow): Parsed {
  if (r.op === "$in" || r.op === "$nin") {
    const items: unknown[] = [];
    for (const t of splitList(r.value)) {
      const p = parseLiteral(t);
      if (!p.ok) return p;
      items.push(p.value);
    }
    return { ok: true, value: items };
  }
  if (r.op === "$exists")
    return { ok: true, value: r.value.trim() !== "false" };
  if (r.op === "$regex") return { ok: true, value: r.value };
  return parseLiteral(r.value);
}

function encodeGroup(keys: GroupKey[], rows: GroupRow[]): Parsed {
  const used = keys.filter((k) => k.field.trim());
  let id: unknown = null;
  if (used.length === 1 && !used[0].name.trim())
    id = `$${used[0].field.trim()}`;
  else if (used.length > 0)
    id = Object.fromEntries(
      used.map((k) => [
        k.name.trim() || lastSegment(k.field.trim()),
        `$${k.field.trim()}`,
      ]),
    );
  const out: Record<string, unknown> = { _id: id };
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    if (r.acc === "$count") {
      out[name] = { $count: {} };
      continue;
    }
    const arg = r.arg.trim();
    if (!arg) return { ok: false, error: `Give ${name} a field or a value` };
    const p = arg.startsWith("$")
      ? ({ ok: true, value: arg } as const)
      : parseLiteral(arg);
    if (!p.ok) return p;
    out[name] = { [r.acc]: p.value };
  }
  return { ok: true, value: out };
}
