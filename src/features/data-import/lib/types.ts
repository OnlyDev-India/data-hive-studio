import type { ImportCell } from "@/shared/api";

/** A cell as parsed: text from CSV and Excel, real values from JSON. */
export type Cell = ImportCell;

export type FileFormat = "csv" | "json" | "jsonl" | "xlsx";
export type Encoding = "utf-8" | "utf-16" | "windows-1252";

export interface ParseOptions {
  encoding: Encoding;
  /** CSV and Excel only: is the first row the header? */
  hasHeader: boolean;
  /** Excel only: the sheet to read. Defaults to the first. */
  sheet?: string;
}

/** A parsed file. `sourceRows[i]` is the file row number of `rows[i]`, so an
 *  error list can point at the row the person sees in their editor. */
export interface ParsedFile {
  format: FileFormat;
  header: string[];
  rows: Cell[][];
  sourceRows: number[];
  /** Excel only: every sheet name, and the one that was read. */
  sheets?: string[];
  sheet?: string;
}
