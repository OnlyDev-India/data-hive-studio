import type { Cell } from "./types";
import { toTable, type RawTable } from "./parse-csv";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A date cell as text the database reads: a plain date when there is no time. */
function dateText(d: Date): string {
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return time === "00:00:00" ? day : `${day} ${time}`;
}

/** Read the first (or the chosen) sheet of an `.xlsx` file. SheetJS is loaded
 *  on first use to keep startup light. */
export async function parseXlsx(
  bytes: ArrayBuffer,
  hasHeader: boolean,
  sheet?: string,
): Promise<RawTable & { sheets: string[]; sheet: string }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  const sheets = wb.SheetNames;
  const name = sheet && sheets.includes(sheet) ? sheet : sheets[0];
  if (!name) throw new Error("This workbook has no sheets.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
  const cells: Cell[][] = grid.map((row) =>
    row.map((v) => (v instanceof Date ? dateText(v) : (v as Cell))),
  );
  return { ...toTable(cells, hasHeader), sheets, sheet: name };
}
