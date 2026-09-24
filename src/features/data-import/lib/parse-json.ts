import type { Cell } from "./types";
import type { RawTable } from "./parse-csv";

/** Build a table from objects: the header is every key in order of first
 *  appearance, and a row missing a key gets null there. */
function fromObjects(
  objects: { value: unknown; sourceRow: number }[],
): RawTable {
  const header: string[] = [];
  const seen = new Set<string>();
  for (const { value, sourceRow } of objects) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Row ${sourceRow} is not an object of column values.`);
    }
    for (const k of Object.keys(value)) {
      if (!seen.has(k)) {
        seen.add(k);
        header.push(k);
      }
    }
  }
  if (header.length === 0) throw new Error("The file has no columns.");
  return {
    header,
    rows: objects.map(({ value }) =>
      header.map((k) => ((value as Record<string, Cell>)[k] ?? null) as Cell),
    ),
    sourceRows: objects.map((o) => o.sourceRow),
  };
}

/** A JSON array of objects, or one object read as a single row. */
export function parseJsonText(text: string): RawTable {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`This is not valid JSON: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const list = Array.isArray(data) ? data : [data];
  return fromObjects(list.map((value, i) => ({ value, sourceRow: i + 1 })));
}

/** JSON Lines: one object per line. Blank lines are skipped but counted. */
export function parseJsonLines(text: string): RawTable {
  const objects: { value: unknown; sourceRow: number }[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      objects.push({ value: JSON.parse(line), sourceRow: i + 1 });
    } catch (e) {
      throw new Error(`Line ${i + 1} is not valid JSON.`, { cause: e });
    }
  });
  return fromObjects(objects);
}
