/** Pure helpers that turn a JSON value into the flat, gutter-numbered line
 *  list rendered by the tree — plus text search over those lines. */

/** A line of the JSON tree: an optional disclosure caret + text segments. */
export interface JsonSegment {
  caret?: boolean;
  text?: string;
  cls?: string;
}

export interface JsonLine {
  id: string;
  depth: number;
  segs: JsonSegment[];
}

function valueSegs(v: unknown): JsonSegment[] {
  const seg = (text: string, cls?: string): JsonSegment => ({ text, cls });
  if (v === null) return [seg("null", "text-purple-600")];
  if (typeof v === "boolean") return [seg(String(v), "text-purple-600")];
  if (typeof v === "number") return [seg(String(v), "text-amber-600")];
  if (typeof v === "string")
    return [seg(JSON.stringify(v), "text-emerald-600")];
  return [seg(JSON.stringify(v))];
}

/** Append one `"key": value` line plus any nested children to `rows`. */
function appendProp(
  key: string,
  value: unknown,
  id: string,
  depth: number,
  rows: JsonLine[],
  collapsed: Set<string>,
) {
  const keySegs: JsonSegment[] = [
    { text: JSON.stringify(key), cls: "text-sky-500" },
    { text: ": ", cls: "text-muted-foreground" },
  ];
  // Only objects/arrays are collapsible — scalars get no caret.
  if (value !== null && typeof value === "object") {
    const open = Array.isArray(value) ? "[" : "{";
    const close = Array.isArray(value) ? "]" : "}";
    if (collapsed.has(id)) {
      rows.push({
        id,
        depth,
        segs: [
          { caret: true },
          ...keySegs,
          { text: `${open} … ${close}`, cls: "text-muted-foreground" },
        ],
      });
      return;
    }
    rows.push({
      id,
      depth,
      segs: [
        { caret: true },
        ...keySegs,
        { text: open, cls: "text-muted-foreground" },
      ],
    });
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value);
    for (const [k, v] of entries)
      appendProp(k, v, `${id}.${k}`, depth + 1, rows, collapsed);
    rows.push({
      id: `${id}.end`,
      depth,
      segs: [{ text: close, cls: "text-muted-foreground" }],
    });
  } else {
    rows.push({ id, depth, segs: [...keySegs, ...valueSegs(value)] });
  }
}

/** Build the flat list of gutter-numbered lines for `data`. */
export function buildLines(data: unknown, collapsed: Set<string>): JsonLine[] {
  const rows: JsonLine[] = [];
  if (!data || typeof data !== "object") {
    rows.push({ id: "$", depth: 0, segs: [...valueSegs(data)] });
    return rows;
  }
  if (collapsed.has("$")) {
    rows.push({
      id: "$",
      depth: 0,
      segs: [{ caret: true }, { text: "{ … }", cls: "text-muted-foreground" }],
    });
    return rows;
  }
  rows.push({
    id: "$",
    depth: 0,
    segs: [{ caret: true }, { text: "{", cls: "text-muted-foreground" }],
  });
  for (const [k, v] of Object.entries(data))
    appendProp(k, v, `$.${k}`, 1, rows, collapsed);
  rows.push({
    id: "$.end",
    depth: 0,
    segs: [{ text: "}", cls: "text-muted-foreground" }],
  });
  return rows;
}

export function lineText(line: JsonLine): string {
  return line.segs.map((s) => s.text ?? "").join("");
}

/** Flat list of occurrences of `q` (case-insensitive), one entry per hit. */
export function collectMatches(lines: JsonLine[], q: string): { id: string }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: { id: string }[] = [];
  for (const line of lines) {
    const text = lineText(line).toLowerCase();
    let i = text.indexOf(needle);
    while (i !== -1) {
      out.push({ id: line.id });
      i = text.indexOf(needle, i + needle.length);
    }
  }
  return out;
}
