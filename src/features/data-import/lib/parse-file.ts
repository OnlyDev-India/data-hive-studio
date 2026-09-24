import { MAX_DATA_ROWS, MAX_FILE_BYTES, formatBytes } from "./limits";
import { decodeText } from "./read-text";
import { parseCsvText, type RawTable } from "./parse-csv";
import { parseJsonLines, parseJsonText } from "./parse-json";
import { parseXlsx } from "./parse-xlsx";
import type { FileFormat, ParseOptions, ParsedFile } from "./types";

/** The format a file name says it is. Anything unknown is read as CSV. */
export function formatOf(name: string): FileFormat {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "json") return "json";
  if (ext === "jsonl" || ext === "ndjson") return "jsonl";
  if (ext === "xlsx") return "xlsx";
  return "csv";
}

/** Read and parse a file. Throws a plain message when it is too big, too long
 *  or unreadable. Nothing is sent anywhere. */
export async function parseFile(
  file: File,
  opts: ParseOptions,
): Promise<ParsedFile> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `This file is ${formatBytes(file.size)}. Import takes files up to ${formatBytes(MAX_FILE_BYTES)}.`,
    );
  }
  const format = formatOf(file.name);
  const buf = await file.arrayBuffer();
  let table: RawTable;
  let extra: { sheets?: string[]; sheet?: string } = {};
  if (format === "xlsx") {
    const x = await parseXlsx(buf, opts.hasHeader, opts.sheet);
    table = x;
    extra = { sheets: x.sheets, sheet: x.sheet };
  } else {
    const text = decodeText(new Uint8Array(buf), opts.encoding);
    table =
      format === "json"
        ? parseJsonText(text)
        : format === "jsonl"
          ? parseJsonLines(text)
          : parseCsvText(text, opts.hasHeader);
  }
  if (table.rows.length > MAX_DATA_ROWS) {
    throw new Error(
      `This file has ${table.rows.length.toLocaleString()} data rows. Import takes up to ${MAX_DATA_ROWS.toLocaleString()}.`,
    );
  }
  return { format, ...table, ...extra };
}
