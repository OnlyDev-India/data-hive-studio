// Client-side parse/validation for MQL "extended JSON" documents (the format
// produced by the Rust `mongo_json` renderer and consumed by the JSON editor).
//
// The Rust backend is the AUTHORITATIVE parser used on save; this module is a
// mirror used for fast, local validation (Before Apply) and for extracting the
// document's `_id` so we can detect type changes. It mirrors the constructor
// set and strict-JSON rules.

export interface MongoParseError {
  message: string;
  /** 0-based byte-ish offset where the error was detected. */
  offset: number;
}

export type MongoJsonValue =
  | { kind: "null" }
  | { kind: "bool"; value: boolean }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number; isInteger: boolean }
  | { kind: "array"; value: MongoJsonValue[] }
  | { kind: "object"; value: Map<string, MongoJsonValue> }
  | { kind: "constructor"; name: string; args: string[] };

const CTRS = new Set([
  "ObjectId",
  "ISODate",
  "Date",
  "NumberLong",
  "Int32",
  "Double",
  "NumberDecimal",
  "Decimal128",
  "Binary",
  "BinData",
  "UUID",
  "RegExp",
  "Timestamp",
  "MinKey",
  "MaxKey",
  "Symbol",
]);

/** Ordered constructor list, reused by the editor for autocomplete +
 *  syntax highlighting. */
export const MONGO_BSON_CONSTRUCTORS = [
  "ObjectId",
  "ISODate",
  "Date",
  "NumberLong",
  "Int32",
  "Double",
  "NumberDecimal",
  "Decimal128",
  "Binary",
  "BinData",
  "UUID",
  "RegExp",
  "Timestamp",
  "MinKey",
  "MaxKey",
  "Symbol",
] as const;

export function parseMongoJson(input: string): {
  value: MongoJsonValue;
  error: MongoParseError | null;
} {
  const p = new Parser(input);
  const value = p.parseDocument();
  if (value === null) {
    return { value: { kind: "null" }, error: p.error };
  }
  return { value, error: null };
}

/** Is this a valid _id-bearing ObjectId expression? Returns the hex id when
 *  the doc's `_id` is `ObjectId("...")`. Used to guard `_id` edits. */
export function extractObjectId(input: string): string | null {
  const { value, error } = parseMongoJson(input);
  if (error || value.kind !== "object") return null;
  const id = value.value.get("_id");
  if (!id || id.kind !== "constructor" || id.name !== "ObjectId") return null;
  const hex = id.args[0] ?? "";
  return /^[0-9a-fA-F]{24}$/.test(hex) ? hex : null;
}

/** True when the document parses with no errors (for the editor lint gutter). */
export function isMongoJsonValid(input: string): boolean {
  return parseMongoJson(input).error === null;
}

// ---- Rendering / reconstruction ---------------------------------------------
// The grid shows Mongo documents as a FLATTENED column view (nested values
// arrive as JSON strings). These helpers reconstruct a document from one grid
// row (single source of truth) and render an AST back to the BSON-constructor
// text the editor understands — mirroring the Rust `mongo_json` renderer.

const JSON_ENCODABLE: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\b": "\\b",
  "\f": "\\f",
};

function jsonEncode(s: string): string {
  let o = "";
  // Cells that slipped in as anything else are coerced defensively so a stray
  // object can never break the BSON renderer.
  for (const c of String(s)) {
    if (JSON_ENCODABLE[c]) o += JSON_ENCODABLE[c];
    else if (c < " ") o += "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0");
    else o += c;
  }
  return '"' + o + '"';
}

/** JSON.parse a cell value into the Mongo AST (objects/arrays preserve nesting). */
function jsonToValue(parsed: unknown): MongoJsonValue {
  if (parsed === null) return { kind: "null" };
  if (typeof parsed === "boolean") return { kind: "bool", value: parsed };
  if (typeof parsed === "number")
    return { kind: "number", value: parsed, isInteger: Number.isSafeInteger(parsed) };
  if (typeof parsed === "string") return { kind: "string", value: parsed };
  if (Array.isArray(parsed))
    return { kind: "array", value: parsed.map(jsonToValue) };
  if (typeof parsed === "object")
    return {
      kind: "object",
      value: new Map(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
          k,
          jsonToValue(v),
        ]),
      ),
    };
  return { kind: "string", value: String(parsed) };
}

const IND = "  ";

function renderCtor(name: string, args: string[]): string {
  const a = (i: number) => args[i] ?? "";
  switch (name) {
    case "Int32":
      return `Int32(${a(0)})`;
    case "Int64":
    case "NumberLong":
      return `NumberLong(${a(0)})`;
    case "Double":
      return `Double(${a(0)})`;
    case "NumberDecimal":
    case "Decimal128":
      return `NumberDecimal(${jsonEncode(a(0))})`;
    case "ISODate":
    case "Date":
      return `ISODate(${jsonEncode(a(0))})`;
    case "ObjectId":
      return `ObjectId(${jsonEncode(a(0))})`;
    case "Binary":
    case "BinData":
      return `Binary(${jsonEncode(a(0))}, ${jsonEncode(a(1))})`;
    case "UUID":
      return `UUID(${jsonEncode(a(0))})`;
    case "RegExp":
      return `/${a(0)}/${a(1)}`;
    case "Timestamp":
      return `Timestamp(${a(0)}, ${a(1)})`;
    case "MinKey":
      return "MinKey()";
    case "MaxKey":
      return "MaxKey()";
    case "Symbol":
      return `Symbol(${jsonEncode(a(0))})`;
    default:
      return `${name}(${args.map(jsonEncode).join(", ")})`;
  }
}

function renderValue(v: MongoJsonValue, depth: number): string {
  switch (v.kind) {
    case "null":
      return "null";
    case "bool":
      return v.value ? "true" : "false";
    case "string":
      return jsonEncode(v.value);
    case "number":
      return v.isInteger ? String(v.value) : String(v.value);
    case "array": {
      if (v.value.length === 0) return "[]";
      let s = "[\n";
      v.value.forEach((x, i) => {
        s += IND.repeat(depth + 1) + renderValue(x, depth + 1);
        if (i < v.value.length - 1) s += ",";
        s += "\n";
      });
      return (s += IND.repeat(depth) + "]");
    }
    case "object":
      return renderObject(v.value, depth);
    case "constructor":
      return renderCtor(v.name, v.args);
  }
}

function renderObject(map: Map<string, MongoJsonValue>, depth: number): string {
  if (map.size === 0) return "{}";
  let s = "{\n";
  let i = 0;
  for (const [k, val] of map) {
    s += IND.repeat(depth + 1) + jsonEncode(k) + ": " + renderValue(val, depth + 1);
    if (i < map.size - 1) s += ",";
    s += "\n";
    i++;
  }
  return s + IND.repeat(depth) + "}";
}

/** Render a parsed Mongo document AST back to BSON-constructor text. */
export function renderMongoDocument(v: MongoJsonValue): string {
  return renderValue(v, 0);
}

/** Extract the ObjectId hex from a flattened grid cell value. Handles the
 *  extended-JSON `{"$oid":"..."}` form and a bare 24-char hex string. */
export function objectIdHexFromCell(cell: string): string | null {
  const m = /^\{\s*"\$oid"\s*:\s*"([0-9a-fA-F]{24})"\s*\}$/.exec(cell);
  if (m) return m[1];
  return /^[0-9a-fA-F]{24}$/.test(cell) ? cell : null;
}

/** Reconstruct a Mongo document AST from one flattened grid row. Nested
 *  object/array cells are JSON-parsed; `_id` (and $oid cells) become ObjectId;
 *  numeric/boolean/date-looking cells are coerced by their schema type. */
export function rowToDocument(
  columns: string[],
  row: (string | null)[],
  typeOf: (col: string) => string | undefined,
): MongoJsonValue {
  const map = new Map<string, MongoJsonValue>();
  columns.forEach((col, ci) => {
    const cell = row[ci];
    if (cell === null) return;
    // Cells are normally flat strings, but the controller's `toJsonValue`
    // already JSON-parses nested document/array columns — so values can arrive
    // as real objects/arrays (plus booleans/numbers). Map those straight onto
    // the AST instead of stringifying them.
    if (typeof cell !== "string") {
      map.set(col, jsonToValue(cell));
      return;
    }
    const t = (typeOf(col) ?? "").toLowerCase();
    if (col === "_id" || t.includes("objectid")) {
      const hex = objectIdHexFromCell(cell) ?? cell;
      map.set(col, { kind: "constructor", name: "ObjectId", args: [hex] });
      return;
    }
    if (t.includes("date") || /^\{\s*"\$date"/.test(cell)) {
      const m = /^\{\s*"\$date"\s*:\s*"([^"]*)"/.exec(cell);
      map.set(col, {
        kind: "constructor",
        name: "ISODate",
        args: [m ? m[1] : cell],
      });
      return;
    }
    if (t.includes("bool")) {
      map.set(col, { kind: "bool", value: cell === "true" });
      return;
    }
    if (/^\{|^\[/.test(cell)) {
      try {
        map.set(col, jsonToValue(JSON.parse(cell)));
      } catch {
        map.set(col, { kind: "string", value: cell });
      }
      return;
    }
    if (/^-?\d+(\.\d+)?$/.test(cell)) {
      const n = Number(cell);
      map.set(col, { kind: "number", value: n, isInteger: Number.isSafeInteger(n) });
      return;
    }
    if (cell === "true" || cell === "false") {
      map.set(col, { kind: "bool", value: cell === "true" });
      return;
    }
    map.set(col, { kind: "string", value: cell });
  });
  return { kind: "object", value: map };
}

class Parser {
  private s: string;
  private i: number;
  error: MongoParseError | null = null;

  constructor(s: string) {
    this.s = s;
    this.i = 0;
  }

  private peek(): string | undefined {
    return this.s[this.i];
  }

  private err(msg: string): null {
    // Column-ish offset in the UTF-16 string.
    this.error = { message: `${msg} at offset ${this.i}`, offset: this.i };
    return null;
  }

  private skipWs(): void {
    while (
      this.i < this.s.length &&
      (this.s[this.i] === " " ||
        this.s[this.i] === "\t" ||
        this.s[this.i] === "\n" ||
        this.s[this.i] === "\r")
    ) {
      this.i++;
    }
  }

  private expect(c: string, what: string): boolean {
    this.skipWs();
    if (this.peek() === c) {
      this.i++;
      return true;
    }
    this.err(`expected ${what}`);
    return false;
  }

  private readIdent(): string | null {
    this.skipWs();
    const start = this.i;
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (/[A-Za-z0-9_$]/.test(c)) this.i++;
      else break;
    }
    if (this.i === start) return this.err("expected a name");
    return this.s.slice(start, this.i);
  }

  private readString(): string | null {
    if (!this.expect('"', '"')) return null;
    let out = "";
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === '"') return out;
      if (c === "\\") {
        const e = this.s[this.i++];
        switch (e) {
          case '"':
            out += '"';
            break;
          case "\\":
            out += "\\";
            break;
          case "/":
            out += "/";
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            const hex = this.s.slice(this.i, this.i + 4);
            this.i += 4;
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return this.err("bad \\u escape");
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            return this.err("invalid escape sequence");
        }
      } else {
        out += c;
      }
    }
    return this.err("unterminated string");
  }

  parseDocument(): MongoJsonValue | null {
    this.skipWs();
    const v = this.parseValue();
    this.skipWs();
    if (v !== null && this.i < this.s.length) return this.err("unexpected trailing content");
    return v;
  }

  private parseValue(): MongoJsonValue | null {
    this.skipWs();
    const c = this.peek();
    if (c === undefined) return this.err("expected a value");
    if (c === "{") return this.parseObject();
    if (c === "[") return this.parseArray();
    if (c === '"') {
      const s = this.readString();
      if (s === null) return null;
      return { kind: "string", value: s };
    }
    if (c === "-" || /[0-9]/.test(c)) return this.parseNumber();
    if (this.s.startsWith("true", this.i)) {
      this.i += 4;
      return { kind: "bool", value: true };
    }
    if (this.s.startsWith("false", this.i)) {
      this.i += 5;
      return { kind: "bool", value: false };
    }
    if (this.s.startsWith("null", this.i)) {
      this.i += 4;
      return { kind: "null" };
    }
    if (c === "/") return this.parseRegex();
    return this.parseConstructor();
  }

  private parseObject(): MongoJsonValue | null {
    this.i++; // {
    const map = new Map<string, MongoJsonValue>();
    this.skipWs();
    if (this.peek() === "}") {
      this.i++;
      return { kind: "object", value: map };
    }
    for (;;) {
      this.skipWs();
      const key = this.readString();
      if (key === null) return null;
      if (!this.expect(":", ":")) return null;
      const val = this.parseValue();
      if (val === null) return null;
      map.set(key, val);
      this.skipWs();
      const c = this.peek();
      if (c === ",") {
        this.i++;
      } else if (c === "}") {
        this.i++;
        return { kind: "object", value: map };
      } else {
        return this.err("expected `,` or `}`");
      }
    }
  }

  private parseArray(): MongoJsonValue | null {
    this.i++; // [
    const arr: MongoJsonValue[] = [];
    this.skipWs();
    if (this.peek() === "]") {
      this.i++;
      return { kind: "array", value: arr };
    }
    for (;;) {
      const val = this.parseValue();
      if (val === null) return null;
      arr.push(val);
      this.skipWs();
      const c = this.peek();
      if (c === ",") {
        this.i++;
      } else if (c === "]") {
        this.i++;
        return { kind: "array", value: arr };
      } else {
        return this.err("expected `,` or `]`");
      }
    }
  }

  private parseNumber(): MongoJsonValue | null {
    const start = this.i;
    let isFloat = false;
    if (this.peek() === "-") this.i++;
    while (/[0-9]/.test(this.peek() ?? "")) this.i++;
    if (this.peek() === ".") {
      isFloat = true;
      this.i++;
      while (/[0-9]/.test(this.peek() ?? "")) this.i++;
    }
    if (this.peek() === "e" || this.peek() === "E") {
      isFloat = true;
      this.i++;
      if (this.peek() === "+" || this.peek() === "-") this.i++;
      while (/[0-9]/.test(this.peek() ?? "")) this.i++;
    }
    const text = this.s.slice(start, this.i);
    if (text === "" || text === "-") return this.err("invalid number");
    const n = Number(text);
    if (Number.isNaN(n)) return this.err("invalid number");
    return { kind: "number", value: n, isInteger: !isFloat && Number.isSafeInteger(n) };
  }

  private parseRegex(): MongoJsonValue | null {
    this.i++; // /
    let pattern = "";
    let closed = false;
    while (this.i < this.s.length) {
      const c = this.s[this.i++];
      if (c === "\\") {
        const n = this.s[this.i++];
        if (n === undefined) break;
        pattern += "\\" + n;
      } else if (c === "/") {
        closed = true;
        break;
      } else {
        pattern += c;
      }
    }
    if (!closed) return this.err("unterminated regex literal");
    let options = "";
    while (this.i < this.s.length && /[A-Za-z0-9]/.test(this.s[this.i])) {
      options += this.s[this.i++];
    }
    return { kind: "constructor", name: "RegExp", args: [pattern, options] };
  }

  private parseConstructor(): MongoJsonValue | null {
    const name = this.readIdent();
    if (name === null) return null;
    if (!CTRS.has(name)) return this.err(`unknown BSON constructor \`${name}()\``);
    if (!this.expect("(", "(")) return null;
    const args: string[] = [];
    this.skipWs();
    if (name === "MinKey" || name === "MaxKey") {
      if (!this.expect(")", ")")) return null;
      return { kind: "constructor", name, args: [] };
    }
    // Collect comma-separated string-or-number arguments.
    for (;;) {
      this.skipWs();
      const c = this.peek();
      if (c === '"') {
        const s = this.readString();
        if (s === null) return null;
        args.push(s);
      } else if (c === undefined) {
        return this.err("unterminated constructor");
      } else {
        // Bare number argument (Timestamp, Int32, BinData, ...).
        const start = this.i;
        if (this.peek() === "-") this.i++;
        while (/[0-9]/.test(this.peek() ?? "")) this.i++;
        if (this.i === start) return this.err(`expected an argument for ${name}()`);
        args.push(this.s.slice(start, this.i));
      }
      this.skipWs();
      const next = this.peek();
      if (next === ",") {
        this.i++;
      } else if (next === ")") {
        this.i++;
        return { kind: "constructor", name, args };
      } else {
        return this.err(`expected \`,\` or \`)\``);
      }
    }
  }
}

/** Convert a plain / extended-JSON value back into a Mongo source AST, so the
 *  right-hand editor can show `ObjectId("…")`, `ISODate("…")`, `NumberLong(…)`
 *  etc. for values that arrived as extended JSON from the grid cells. */
export function plainToMongo(v: unknown): MongoJsonValue {
  if (v === null) return { kind: "null" };
  if (typeof v === "boolean") return { kind: "bool", value: v };
  if (typeof v === "number")
    return { kind: "number", value: v, isInteger: Number.isSafeInteger(v) };
  if (typeof v === "string") return { kind: "string", value: v };
  if (Array.isArray(v)) return { kind: "array", value: v.map(plainToMongo) };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Object.keys(o).length === 1) {
      const k = Object.keys(o)[0];
      const ctor = (name: string, args: string[]): MongoJsonValue => ({
        kind: "constructor",
        name,
        args,
      });
      switch (k) {
        case "$oid":
          return ctor("ObjectId", [String(o["$oid"])]);
        case "$numberInt":
          return ctor("Int32", [String(o["$numberInt"])]);
        case "$numberLong":
          return ctor("NumberLong", [String(o["$numberLong"])]);
        case "$numberDouble":
          return ctor("Double", [String(o["$numberDouble"])]);
        case "$numberDecimal":
          return ctor("NumberDecimal", [String(o["$numberDecimal"])]);
        case "$symbol":
          return ctor("Symbol", [String(o["$symbol"])]);
        case "$minKey":
          return ctor("MinKey", []);
        case "$maxKey":
          return ctor("MaxKey", []);
        case "$date": {
          const d = o["$date"];
          const iso =
            typeof d === "string"
              ? d
              : String((d as Record<string, unknown>)?.["$numberLong"] ?? "");
          return ctor("ISODate", [iso]);
        }
        case "$binary": {
          const b = (o["$binary"] ?? {}) as Record<string, unknown>;
          const sub = String(b.subType ?? "00").toLowerCase();
          return ctor("Binary", [
            String(b.base64 ?? ""),
            sub.length <= 2 ? String(parseInt(sub, 16)) : sub,
          ]);
        }
        case "$timestamp": {
          const t = (o["$timestamp"] ?? {}) as Record<string, unknown>;
          return ctor("Timestamp", [String(t.t ?? ""), String(t.i ?? "")]);
        }
        case "$regularExpression": {
          const r = (o["$regularExpression"] ?? {}) as Record<string, unknown>;
          return {
            kind: "constructor",
            name: "RegExp",
            args: [String(r.pattern ?? ""), String(r.options ?? "")],
          };
        }
      }
    }
    return {
      kind: "object",
      value: new Map(
        Object.entries(o).map(([k, x]) => [k, plainToMongo(x)]),
      ),
    };
  }
  return { kind: "string", value: String(v) };
}

/** Strip a Mongo AST back to plain JSON (used to serialize object/array-typed
 *  grid cells on write-back). */
export function mongoToPlain(v: MongoJsonValue): unknown {
  switch (v.kind) {
    case "null":
      return null;
    case "bool":
      return v.value;
    case "number":
      return v.value;
    case "string":
      return v.value;
    case "array":
      return v.value.map(mongoToPlain);
    case "object":
      return Object.fromEntries(
        [...v.value.entries()].map(([k, x]) => [k, mongoToPlain(x)]),
      );
    case "constructor":
      return v.args.length === 1 ? v.args[0] : v.args;
  }
}

/** Convert an edited Mongo AST leaf back to the flat grid-cell string the Mongo
 *  adapter (`field_bson`) understands when writing an update. */
export function valueToCell(v: MongoJsonValue): string | null {
  if (v.kind === "null") return null;
  switch (v.kind) {
    case "bool":
      return v.value ? "true" : "false";
    case "number":
      return String(v.value);
    case "string":
      return v.value;
    case "constructor": {
      const a0 = v.args[0] ?? "";
      switch (v.name) {
        case "ObjectId":
          return objectIdHexFromCell(a0) ?? a0;
        case "ISODate":
        case "Date":
        case "Int32":
        case "Int64":
        case "NumberLong":
        case "Double":
        case "NumberDecimal":
        case "Decimal128":
        case "UUID":
          return a0;
        case "Binary":
        case "BinData":
          return JSON.stringify({
            $binary: {
              base64: a0,
              subType: (v.args[1] ?? "00").toLowerCase().replace(/^0x/, ""),
            },
          });
        case "RegExp":
          return `/${a0}/${v.args[1] ?? ""}`;
        default:
          return a0;
      }
    }
    case "array":
    case "object":
      return JSON.stringify(mongoToPlain(v));
  }
}
