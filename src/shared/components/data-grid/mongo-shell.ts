// Staged grid changes rendered as Mongo shell commands the Mongo console can
// run. Values follow the same coercion the backend applies on Apply
// (`field_bson` / `filter_from_match_row` in dh-core's mongodb/filter.rs), so
// running the text writes the same BSON types Apply would. Typed values use
// extended JSON (`{"$oid": ...}`), not shell constructors: the console reads
// its arguments as plain JSON.

type Row = Record<string, string | null>;
type Types = Record<string, string>;

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

const is_object_id_hex = (s: string) => /^[0-9a-fA-F]{24}$/.test(s);

function as_i64(v: string): string | null {
  if (!/^[+-]?\d+$/.test(v)) return null;
  const n = BigInt(v);
  return n >= I64_MIN && n <= I64_MAX ? n.toString() : null;
}

function as_double(v: string): string | null {
  if (!FLOAT_RE.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // Keep a fraction so the console reads it back as a double, not an int.
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

function as_json(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

const long = (i: string) => `{ "$numberLong": ${JSON.stringify(i)} }`;

/** One grid cell as a shell literal, coerced by its column type. */
export function mongo_value(v: string | null, data_type?: string): string {
  if (v === null) return "null";
  const t = (data_type ?? "").toLowerCase();
  if (t.includes("object") || t.includes("array") || t.includes("bson")) {
    const j = as_json(v);
    return j === undefined ? JSON.stringify(v) : JSON.stringify(j);
  }
  if (t.includes("bool")) return v === "true" || v === "1" ? "true" : "false";
  if (t === "date" && !Number.isNaN(Date.parse(v))) {
    return `{ "$date": ${JSON.stringify(new Date(v).toISOString())} }`;
  }
  if (t.includes("int") || t.includes("long")) {
    const i = as_i64(v);
    if (i !== null) return long(i);
    const d = as_double(v);
    if (d !== null) return d;
  }
  if (t.includes("double") || t.includes("float") || t.includes("decimal")) {
    const d = as_double(v);
    if (d !== null) return d;
  }
  if (v === "true" || v === "1") return "true";
  if (v === "false" || v === "0") return "false";
  const i = as_i64(v);
  if (i !== null && !is_object_id_hex(v)) return long(i);
  const d = as_double(v);
  if (d !== null) return d;
  const j = as_json(v);
  if (j !== null && typeof j === "object") return JSON.stringify(j);
  return JSON.stringify(v);
}

function doc(entries: [string, string][]): string {
  return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(", ")} }`;
}

/** Filter for one row, matched the way Apply matches it: `_id` hex as a real
 *  ObjectId, every other field with no type hint. */
export function mongo_filter(match_row: Row): string {
  return doc(
    Object.entries(match_row).map(([k, v]) => [
      k,
      k === "_id" && v !== null && is_object_id_hex(v)
        ? `{ "$oid": ${JSON.stringify(v)} }`
        : mongo_value(v),
    ]),
  );
}

/** Empty fields are left out so defaults apply; an empty `_id` is always
 *  left out so MongoDB generates one. */
export function mongo_insert(
  collection: string,
  values: Row,
  types: Types,
): string | null {
  const entries = Object.entries(values)
    .filter(([, v]) => v !== null && v !== "")
    .map(([k, v]): [string, string] => [k, mongo_value(v, types[k])]);
  if (entries.length === 0) return null;
  return `db.${collection}.insertOne(${doc(entries)});`;
}

/** `_id` is never rewritten, same as Apply. */
export function mongo_update(
  collection: string,
  match_row: Row,
  col: string,
  value: string | null,
  types: Types,
): string | null {
  if (col === "_id") return null;
  return `db.${collection}.updateMany(${mongo_filter(match_row)}, { "$set": ${doc([[col, mongo_value(value, types[col])]])} });`;
}

export function mongo_delete(collection: string, match_row: Row): string {
  return `db.${collection}.deleteMany(${mongo_filter(match_row)});`;
}
