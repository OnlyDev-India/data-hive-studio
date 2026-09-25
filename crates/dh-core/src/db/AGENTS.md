# dh-core: db adapters

## Overview

The shared Rust database layer used by both the Tauri app (`src-tauri`) and the optional
team server (`crates/dh-server`): one `DbAdapter` trait implemented per backend (SQLite,
PostgreSQL, MongoDB), plus the Mongo extended-JSON (BSON) parser/renderer that lets Mongo
rows round-trip through the same text-editing UI as SQL rows.

## Key files

| File | Owns |
|---|---|
| `mod.rs` | The front door: `mod` and `pub use` lines only, so every `db::` path stays stable |
| `types.rs`, `adapter.rs` | Result and error types, and the `DbAdapter` trait (one impl per backend) with its default method bodies |
| `registry.rs`, `activity_log.rs` | The connection registry, and the activity log helpers |
| `catalog.rs`, `documents.rs`, `query.rs`, `ddl.rs` | Free functions that look up a connection and call its adapter, grouped by job |
| `sqlite/`, `postgres/`, `mongodb/` | Per backend `DbAdapter` implementations, each a folder of topic files with the same names for the same job (`params`, `connect`, `catalog`, `query`, `edit`, `ddl`, `cancel`, `adapter`, `tests`) |
| `mongo_json/` | MQL extended JSON parser (`parse`) and renderer (`render`) for BSON documents |
| `mongo_sql/` | Translates SQL shaped queries into Mongo `find`/`aggregate` calls |
| `explain/` | Turns each engine's explain output into one `PlanNode` tree (`postgres`, `sqlite`, `mongo`), plus `support` (which statements Explain accepts) and `tree` (ids and the node cap). The per backend `explain.rs` files run the call; the types live in `api/common/plan.rs` |

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

- For Postgres and MongoDB, `adapter.rs` holds `impl DbAdapter` as one line calls into inherent
  methods in the topic files (SQLite delegates the same way), so a new trait method needs a
  wrapper in `adapter.rs` plus the method itself in a topic file.

- Explain is built in Rust, never in a frontend adapter. An estimate never runs the statement, and a
  PostgreSQL Explain Analyze always runs inside a transaction that is rolled back, also on error and
  Stop. A plan is cut at `MAX_PLAN_NODES` (5000) and marked `truncated`.

## Gotchas

- `mongo_json::parse` is strict: it errors on trailing content after the document and on a
  non-object root value — a bare array or scalar at the top level is rejected, not coerced.
- Schema DDL (`apply_schema_ops`) runs as one atomic backend transaction; grid row edits do
  **not** — they're independent statements, so a multi-cell edit can partially land.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
