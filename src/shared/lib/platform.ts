import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "../api/client";

/**
 * Whether database files are picked through a file dialog the app opens
 * itself. In a Tauri desktop build this is always true.
 */
export function selfPicksFiles(): boolean {
  return true;
}

/**
 * Open the native file dialog and return the picked file. Always includes the
 * absolute `path` in a desktop (Tauri) build; `bytes` is kept for fallback.
 */
export async function pickDatabaseFile(): Promise<{
  path: string;
  name: string;
  bytes: number[];
} | null> {
  const path = await open({
    multiple: false,
    filters: [
      { name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] },
    ],
  });
  if (!path || Array.isArray(path)) return null;
  const name = path.split(/[/\\]/).pop() ?? "database.db";
  const bytes = await readFile(path);
  return { path, name, bytes };
}

/**
 * Show the native save dialog and write the bytes. Returns the chosen file
 * path, or `null` if the user cancels.
 */
export async function saveBytes(
  name: string,
  bytes: number[],
): Promise<string | null> {
  const path = await save({
    defaultPath: name,
    filters: [
      { name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] },
    ],
  });
  if (!path || Array.isArray(path)) return null;
  await writeFile(path, bytes);
  return path;
}
/**
 * Native "Save as" dialog for SQL scripts. Returns the chosen path, or
 * `null` if the user cancels.
 */
export async function pickSqlSavePath(): Promise<string | null> {
  const path = await save({
    defaultPath: "query.sql",
    filters: [{ name: "SQL script", extensions: ["sql"] }],
  });
  return !path || Array.isArray(path) ? null : path;
}

/**
 * Native "Open" dialog for a SQL script — reads the picked file and decodes
 * it as UTF-8 text, ready to seed a new SQL editor tab. Returns `null` if
 * the user cancels.
 */
export async function pickSqlFile(): Promise<{
  path: string;
  name: string;
  text: string;
} | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: "SQL script", extensions: ["sql", "txt"] }],
  });
  if (!path || Array.isArray(path)) return null;
  const name = path.split(/[/\\]/).pop() ?? "query.sql";
  const bytes = await readFile(path);
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  return { path, name, text };
}
