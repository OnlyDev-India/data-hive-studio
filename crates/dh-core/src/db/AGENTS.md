# dh-core: db adapters

## Overview

The shared Rust database layer used by both the Tauri app (`src-tauri`) and the optional
team server (`crates/dh-server`): one `DbAdapter` trait implemented per backend (SQLite,
PostgreSQL, MongoDB), plus the Mongo extended-JSON (BSON) parser/renderer that lets Mongo
rows round-trip through the same text-editing UI as SQL rows.

## Key files

| File | Owns |
|---|---|
| `mod.rs` | `DbAdapter` trait (one impl per backend), shared result/error types |
| `sqlite.rs` / `postgres.rs` / `mongodb.rs` | Per-backend `DbAdapter` implementations |
| `mongo_json.rs` | MQL extended-JSON parser (`parse`) and renderer (`render`) for BSON documents |
| `mongo_sql.rs` | Translates SQL-shaped queries into Mongo `find`/`aggregate` calls |

## Conventions

- `DbAdapter` methods take `database`/`schema` as `Option<&str>`: `None` means "this
  connection's own current database/schema" (every existing call site keeps behaving
  identically); `Some` targets a specific database/schema directly, without touching the
  adapter's ambient state — used so a table pane pinned to a sibling database never
  race-leaks against another pane's target. Postgres routes `Some(database)` through
  `PgAdapter::pool_for`.
- Large results (`run_sql`/schema ops) stream back via a Tauri `Channel` in batches rather
  than being loaded fully into memory — follow that pattern for any new bulk read.
- `mongo_json::render` must stay a lossless round-trip of what `parse` accepts: a value
  parsed from a BSON constructor call (`ObjectId(...)`, `ISODate(...)`, `NumberLong(...)`,
  etc.) must render back to that same constructor form, not degrade to a plain string/number.

## Gotchas

- `mongo_json::parse` is strict: it errors on trailing content after the document and on a
  non-object root value — a bare array or scalar at the top level is rejected, not coerced.
- Schema DDL (`apply_schema_ops`) runs as one atomic backend transaction; grid row edits do
  **not** — they're independent statements, so a multi-cell edit can partially land.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
