/** A typed BSON value read from canonical extended JSON. */
export type Ext =
  | { t: "oid"; hex: string }
  | { t: "date"; ms: number }
  | { t: "long"; n: string }
  | { t: "int"; n: string }
  | { t: "double"; n: string }
  | { t: "decimal"; n: string }
  | { t: "regex"; pattern: string; options: string }
  | { t: "binary"; base64: string; subType: number }
  | { t: "timestamp"; time: number; inc: number }
  | { t: "minKey" }
  | { t: "maxKey" };

const one = (o: Record<string, unknown>, k: string) =>
  Object.keys(o).length === 1 && k in o;

/** The typed value an extended JSON wrapper such as `{"$oid": …}` stands
 *  for, or null for a plain value. */
export function extOf(v: unknown): Ext | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (one(o, "$oid") && typeof o.$oid === "string")
    return { t: "oid", hex: o.$oid };
  if (one(o, "$date")) {
    const d = o.$date;
    if (typeof d === "string") return { t: "date", ms: Date.parse(d) };
    if (typeof d === "number") return { t: "date", ms: d };
    const long = extOf(d);
    if (long?.t === "long") return { t: "date", ms: Number(long.n) };
  }
  for (const [key, t] of [
    ["$numberLong", "long"],
    ["$numberInt", "int"],
    ["$numberDouble", "double"],
    ["$numberDecimal", "decimal"],
  ] as const)
    if (one(o, key) && typeof o[key] === "string")
      return { t, n: o[key] as string };
  if (one(o, "$regularExpression")) {
    const r = o.$regularExpression as Record<string, string>;
    return { t: "regex", pattern: r.pattern ?? "", options: r.options ?? "" };
  }
  if (one(o, "$binary")) {
    const b = o.$binary as Record<string, string>;
    return {
      t: "binary",
      base64: b.base64 ?? "",
      subType: parseInt(b.subType ?? "0", 16),
    };
  }
  if (one(o, "$timestamp")) {
    const ts = o.$timestamp as Record<string, number>;
    return { t: "timestamp", time: ts.t ?? 0, inc: ts.i ?? 0 };
  }
  if (one(o, "$minKey")) return { t: "minKey" };
  if (one(o, "$maxKey")) return { t: "maxKey" };
  return null;
}

/** Whether a whole number fits a 32 bit int, so it can be written plain. */
export function fitsInt32(n: string): boolean {
  const v = Number(n);
  return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
}

/** How one language writes values. */
export interface Syntax {
  indent: string;
  key: (k: string) => string;
  literal: { null: string; true: string; false: string };
  /** A typed value, naming each import it needs through `need`. */
  ext: (e: Ext, need: (name: string) => void) => string;
}

/** A value this short stays on one line. */
const INLINE_MAX = 72;

/** `v` as source text at `depth`, breaking onto lines when it is long. */
export function valueText(
  v: unknown,
  depth: number,
  s: Syntax,
  need: (name: string) => void,
): string {
  const e = extOf(v);
  if (e) return s.ext(e, need);
  if (v === null || v === undefined) return s.literal.null;
  if (v === true) return s.literal.true;
  if (v === false) return s.literal.false;
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return String(v);
  const array = Array.isArray(v);
  const parts = array
    ? (v as unknown[]).map((x) => valueText(x, depth + 1, s, need))
    : Object.entries(v as Record<string, unknown>).map(
        ([k, x]) => `${s.key(k)}: ${valueText(x, depth + 1, s, need)}`,
      );
  const [open, close] = array ? ["[", "]"] : ["{", "}"];
  if (parts.length === 0) return open + close;
  const pad = array ? "" : " ";
  const inline = `${open}${pad}${parts.join(", ")}${pad}${close}`;
  if (
    !inline.includes("\n") &&
    inline.length + depth * s.indent.length <= INLINE_MAX
  )
    return inline;
  const inner = s.indent.repeat(depth + 1);
  return `${open}\n${parts.map((p) => inner + p).join(",\n")}\n${s.indent.repeat(depth)}${close}`;
}

/** One stage of the pipeline with the comment lines that go before it. */
export interface CodeStage {
  stage: unknown;
  comments: string[];
}

/** The pipeline's stages next to their cards' titles and notes. */
export interface CodeInput {
  collection: string;
  stages: CodeStage[];
}
