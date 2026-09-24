import Papa from "papaparse";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@/shared/api/client";
import type { Failure } from "./prepare";
import type { ParsedFile } from "./types";

/** "column: message", or just the message when no column is known. */
export function failureText(f: Pick<Failure, "column" | "message">): string {
  return f.column ? `${f.column}: ${f.message}` : f.message;
}

/** Every failed row as CSV: the file's own columns, then the reason. Fix the
 *  rows and import this file again. */
export function buildFailedCsv(
  parsed: ParsedFile,
  failures: Failure[],
): string {
  const body = failures.map((f) => [
    ...parsed.rows[f.rowIndex].map((c) =>
      c === null ? "" : typeof c === "object" ? JSON.stringify(c) : c,
    ),
    failureText(f),
  ]);
  return Papa.unparse({ fields: [...parsed.header, "reason"], data: body });
}

/** Ask where to save the failed rows and write them. Null when cancelled. */
export async function saveFailedCsv(
  parsed: ParsedFile,
  failures: Failure[],
  baseName: string,
): Promise<string | null> {
  const path = await save({
    defaultPath: `${baseName}-failed-rows.csv`,
    filters: [{ name: "CSV file", extensions: ["csv"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const csv = buildFailedCsv(parsed, failures);
  await writeFile(path, Array.from(new TextEncoder().encode(csv)));
  return path;
}
