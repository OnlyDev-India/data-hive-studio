import Papa from "papaparse";
import type { Cell } from "./types";

export interface RawTable {
  header: string[];
  rows: Cell[][];
  sourceRows: number[];
}

const isBlank = (row: Cell[]) => row.every((c) => c === "" || c === null);

/** Turn a grid of text rows into a table. A blank row is dropped, but the file
 *  row numbers still count it. With no header, columns are named Column 1, 2… */
export function toTable(grid: Cell[][], hasHeader: boolean): RawTable {
  const rows: Cell[][] = [];
  const sourceRows: number[] = [];
  let header: string[] = [];
  grid.forEach((row, i) => {
    if (isBlank(row)) return;
    if (hasHeader && header.length === 0) {
      header = row.map((h) => String(h ?? "").trim());
      return;
    }
    rows.push(row);
    sourceRows.push(i + 1);
  });
  if (!hasHeader) {
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    header = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  } else if (header.length === 0 || header.every((h) => h === "")) {
    throw new Error("The file has no header row.");
  }
  return { header, rows, sourceRows };
}

/** Read CSV text. The separator is guessed from the first non blank lines, so
 *  a blank line under the header cannot confuse it. */
export function parseCsvText(text: string, hasHeader: boolean): RawTable {
  const guess = Papa.parse<string[]>(text, {
    preview: 10,
    skipEmptyLines: "greedy",
  });
  const result = Papa.parse<string[]>(text, {
    delimiter: guess.meta.delimiter,
  });
  return toTable(result.data, hasHeader);
}
