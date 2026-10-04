/** Canonical Extended JSON (what compose returns) to and from the shell
 *  literals a form shows in a value box: `10`, `"A"`, `ObjectId("…")`. */

type Json = unknown;

const isObj = (v: Json): v is Record<string, Json> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const WRAPPERS = new Set([
  "$oid",
  "$date",
  "$numberInt",
  "$numberLong",
  "$numberDouble",
  "$numberDecimal",
  "$binary",
  "$uuid",
  "$regularExpression",
  "$timestamp",
  "$minKey",
  "$maxKey",
  "$symbol",
  "$code",
  "$dbPointer",
  "$undefined",
]);

/** An Extended JSON wrapper like `{ $oid: … }`: a scalar, not a document. */
export function isWrapper(v: Json): boolean {
  if (!isObj(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.length <= 2 && WRAPPERS.has(keys[0]);
}

/** A plain document a form can walk, not a wrapper. */
export function isDoc(v: Json): v is Record<string, Json> {
  return isObj(v) && !isWrapper(v);
}

/** The whole number a value holds, if it is one. */
export function intOf(v: Json): number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (!isObj(v)) return null;
  const raw = v.$numberInt ?? v.$numberLong;
  if (typeof raw === "string" && /^-?\d+$/.test(raw)) return Number(raw);
  const d = v.$numberDouble;
  if (typeof d === "string" && /^-?\d+(\.0*)?$/.test(d)) return Number(d);
  return null;
}

export function long(n: number | string): Json {
  return { $numberLong: String(n) };
}

/** A value as the literal a value box shows, or null when it is not a
 *  scalar (a document, an array, a regex). */
export function literalOf(v: Json): string | null {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return String(v);
  if (!isObj(v)) return null;
  if (typeof v.$numberInt === "string") return v.$numberInt;
  if (typeof v.$numberLong === "string") return v.$numberLong;
  if (typeof v.$numberDouble === "string") {
    const d = v.$numberDouble;
    return /^-?\d+$/.test(d) ? `${d}.0` : d;
  }
  if (typeof v.$numberDecimal === "string")
    return `NumberDecimal(${JSON.stringify(v.$numberDecimal)})`;
  if (typeof v.$oid === "string") return `ObjectId(${JSON.stringify(v.$oid)})`;
  if ("$date" in v) {
    const d = v.$date;
    const ms = isObj(d) ? Number(d.$numberLong) : Date.parse(String(d));
    if (Number.isNaN(ms)) return null;
    return `ISODate(${JSON.stringify(new Date(ms).toISOString())})`;
  }
  return null;
}

export type Parsed = { ok: true; value: Json } | { ok: false; error: string };

const call = (name: string) =>
  new RegExp(`^(?:new\\s+)?${name}\\(\\s*(["']?)(.*?)\\1\\s*\\)$`);

/** A literal typed into a value box as canonical Extended JSON. Text that is
 *  no literal is taken as a string, so `A` and `"A"` mean the same. */
export function parseLiteral(text: string): Parsed {
  const t = text.trim();
  if (/^-?\d+$/.test(t)) return { ok: true, value: long(t) };
  if (/^-?(\d+\.\d*|\.\d+|\d+(\.\d*)?e[+-]?\d+)$/i.test(t))
    return { ok: true, value: { $numberDouble: t } };
  if (t === "true" || t === "false") return { ok: true, value: t === "true" };
  if (t === "null") return { ok: true, value: null };
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) {
    try {
      return { ok: true, value: JSON.parse(t) as string };
    } catch {
      return { ok: false, error: "This string has a bad escape" };
    }
  }
  if (/^'[^']*'$/.test(t)) return { ok: true, value: t.slice(1, -1) };
  let m = call("ObjectId").exec(t);
  if (m) {
    return /^[0-9a-f]{24}$/i.test(m[2])
      ? { ok: true, value: { $oid: m[2].toLowerCase() } }
      : { ok: false, error: "An ObjectId is 24 hex digits" };
  }
  m = call("(?:ISODate|Date)").exec(t);
  if (m) {
    const ms = Date.parse(m[2]);
    return Number.isNaN(ms)
      ? { ok: false, error: `"${m[2]}" is not a date` }
      : { ok: true, value: { $date: long(ms) } };
  }
  m = call("(?:NumberDecimal|Decimal128)").exec(t);
  if (m) return { ok: true, value: { $numberDecimal: m[2] } };
  m = call("(?:NumberLong|Long)").exec(t);
  if (m && /^-?\d+$/.test(m[2])) return { ok: true, value: long(m[2]) };
  m = call("(?:NumberInt|Int32)").exec(t);
  if (m && /^-?\d+$/.test(m[2]))
    return { ok: true, value: { $numberInt: m[2] } };
  return { ok: true, value: t };
}

/** Split `1, "a, b", 3` on the commas outside quotes and brackets. */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") {
        cur += c + (text[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `"$a.b"` as `a.b`; null for anything that is no field reference
 *  (`$$ROOT` included). */
export function fieldOf(v: Json): string | null {
  return typeof v === "string" && /^\$[^$]/.test(v) ? v.slice(1) : null;
}

/** The last segment of a dotted path, a default output name. */
export function lastSegment(path: string): string {
  return path.split(".").pop() ?? path;
}
