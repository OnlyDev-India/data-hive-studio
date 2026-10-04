export type LibraryKind = "query" | "snippet";
export type LibraryLanguage = "sql" | "mongo";

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  language: LibraryLanguage;
  name: string;
  text: string;
  /** Snippets only; always null on a query. */
  trigger: string | null;
  created_at: number;
  updated_at: number;
}

/** `library.json` on desktop, `localStorage["dh.web.library"]` on web. */
export interface LibraryFile {
  version: 1;
  seeded: boolean;
  items: LibraryItem[];
}

/** What every save path takes in: the fields a person edits. */
export interface LibraryDraft {
  kind: LibraryKind;
  language: LibraryLanguage;
  name: string;
  text: string;
  trigger: string | null;
}

export type LibraryField = "name" | "text" | "trigger";

export type LibraryResult =
  | { ok: true; item: LibraryItem }
  | { ok: false; field: LibraryField | null; message: string };

export interface ImportSummary {
  added: number;
  updated: number;
  unchanged: number;
  triggersCleared: number;
  skipped: number;
}

/** The library language a connection's editor uses. */
export function connectionLanguage(
  kind: "sqlite" | "postgres" | "mysql" | "mongodb" | "documentdb",
): LibraryLanguage {
  return kind === "mongodb" || kind === "documentdb" ? "mongo" : "sql";
}

/** The editor's `language` prop to the library language. */
export function libraryLanguageOf(
  editorLanguage: "sql" | "js",
): LibraryLanguage {
  return editorLanguage === "js" ? "mongo" : "sql";
}
