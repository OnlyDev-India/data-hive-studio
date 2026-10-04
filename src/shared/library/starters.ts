import type { LibraryDraft } from "./types";

const snippet = (
  language: LibraryDraft["language"],
  trigger: string,
  name: string,
  text: string,
): LibraryDraft => ({ kind: "snippet", language, trigger, name, text });

/** Added once to a library that was never seeded. */
export const STARTER_SNIPPETS: LibraryDraft[] = [
  snippet(
    "sql",
    "sel",
    "Select rows",
    "SELECT ${1:*} FROM ${2:table} LIMIT ${3:100};",
  ),
  snippet("sql", "cnt", "Count rows", "SELECT COUNT(*) FROM ${1:table};"),
  snippet(
    "sql",
    "ins",
    "Insert row",
    "INSERT INTO ${1:table} (${2:columns}) VALUES (${3:values});",
  ),
  snippet(
    "sql",
    "upd",
    "Update where",
    "UPDATE ${1:table} SET ${2:column} = ${3:value} WHERE ${4:condition};",
  ),
  snippet(
    "sql",
    "delw",
    "Delete where",
    "DELETE FROM ${1:table} WHERE ${2:condition};",
  ),
  snippet(
    "mongo",
    "find",
    "Find documents",
    "db.${1:collection}.find({ ${2} }).limit(${3:100})",
  ),
  snippet(
    "mongo",
    "cntd",
    "Count documents",
    "db.${1:collection}.countDocuments({ ${2} })",
  ),
  snippet(
    "mongo",
    "agg",
    "Aggregate",
    "db.${1:collection}.aggregate([\n  { $match: { ${2} } }\n])",
  ),
];
