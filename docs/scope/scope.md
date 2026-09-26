# Scope: DH Studio

A Tauri desktop app for managing SQLite, PostgreSQL, and MongoDB databases, with an optional bare server and web UI that only connect to databases (no login, sharing, orgs or groups for now, see slice 29).

**Build approach:** Tracer Bullet (each feature built end to end through every layer, working).
**Workflow:** Beta (after `/develop`, run `/check verify` then `/test`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· GA`) to do more or less.

*These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use* `/develop` *and skip* `/architect`*. You decide when a feature is* `done`*.*

## At a glance

| #   | Feature                                     | Phase    | Status      |
| --- | ------------------------------------------- | -------- | ----------- |
| A   | Connections                                 | Existing | existing    |
| B   | Table explorer                              | Existing | existing    |
| C   | Query editor                                | Existing | existing    |
| D   | Schema designer                             | Existing | existing    |
| E   | Workspace shell                             | Existing | existing    |
| F   | Activity log                                | Existing | existing    |
| G   | Data inspector                              | Existing | existing    |
| H   | Data export                                 | Existing | existing    |
| J   | Settings                                    | Existing | existing    |
| K   | Notifications                               | Existing | existing    |
| L   | Auto updater                                | Existing | existing    |
| M   | Data grid                                   | Existing | existing    |
| N   | Shared query editor components              | Existing | existing    |
| O   | DB adapter layer                            | Existing | existing    |
| P   | Team server                                 | Existing | existing    |
| Q   | Native shell                                | Existing | existing    |
| R   | Command palette                             | Existing | existing    |
| 10  | Stop a running query                        | Slice 10 | done        |
| 11  | Read only and environment labels            | Slice 11 | done        |
| 12  | Import data                                 | Slice 12 | done        |
| 13  | Explain plan viewer                         | Slice 13 | done        |
| 17  | Streaming results for Postgres and MongoDB  | Slice 17 | done        |
| 28  | Split server only code into its own crate   | Slice 28 | done        |
| 29  | Strip the server to a bare no login proxy   | Slice 29 | done        |
| 30  | Connection form as a two step flow          | Slice 30 | in-progress |
| 5   | Table comparison view                       | Slice 5  | planned     |
| 14  | Saved queries and snippets                  | Slice 14 | planned     |
| 15  | Mongo aggregation builder                   | Slice 15 | planned     |
| 16  | ER diagram                                  | Slice 16 | planned     |

## Existing

### A. Connections · existing
DB connection setup and management across SQLite, PostgreSQL, and MongoDB, with SSH tunneling. code in `src/features/connections`

### B. Table explorer · existing
Browse tables and collections through the data grid, with schema editing reachable from the same pane. code in `src/features/table-explorer`

### C. Query editor · existing
SQL and Mongo query editing with multi statement execution, bind variables, dangerous SQL warnings, and streamed result tabs. code in `src/features/query-editor`

### D. Schema designer · existing
DDL design: create tables and collections, manage indexes and roles, atomic schema transactions. code in `src/features/schema-designer`

### E. Workspace shell · existing
Tab and pane management: sidebar, tab bar, resizable panes, drag and drop tab reordering. code in `src/features/workspace`

### F. Activity log · existing
Filterable activity history feed with a details view. code in `src/features/activity`

### G. Data inspector · existing
JSON/BSON document viewer with tree navigation, syntax highlighting, and search. code in `src/features/inspector`

### H. Data export · existing
Export query or table data to Excel, CSV, JSON, SQL inserts, or Markdown, filtered or in full. code in `src/features/data-export`

### J. Settings · existing
App configuration: appearance, command palette, keyboard shortcuts, SQL formatting, about. code in `src/features/settings`

### K. Notifications · existing
In-app notification center: bell popover, toasts, dismissible items, mark all read. code in `src/features/notifications`

### L. Auto updater · existing
Checks for app updates and walks the user through downloading one. code in `src/features/updater`

### M. Data grid · existing
The virtualized spreadsheet grid shared across features: multi cell selection, fill handle, staged edits, column filters and reorder, FK jump links. code in `src/shared/components/data-grid`

### N. Shared query editor components · existing
CodeMirror based SQL/Mongo editing: syntax highlighting, bind variable detection, signature help, the BSON JSON editor. code in `src/shared/components/query-editor`

### O. DB adapter layer · existing
Shared Rust database layer: per backend adapters for SQLite, PostgreSQL, and MongoDB, plus the Mongo BSON parser/renderer. code in `crates/dh-core/src/db`

### P. Team server · existing
Optional Axum server and web UI that only connects to databases, with no login, orgs or sharing (reshaped by slice 29). code in `crates/dh-server`, `src/web`

### Q. Native shell · existing
Tauri native shell: app menu, commands, local connection state, activity store, file open. code in `src-tauri`

### R. Command palette · existing
Keyboard driven navigation: filter and open connections, tables, and tabs, run commands. code in `src/app/studio/command-palette.tsx`

## Done

Shipped and committed. The milestone detail lives in each spec's `## Build plan`. Where verify and test were not run, the note says so; run them any time if you want the extra check.

### 10. Stop a running query · done
A Stop button in the editor cancels a running query on SQLite, PostgreSQL, and MongoDB (desktop and web), and the tab shows it was stopped, not failed.
spec [0006](../specs/0006-stop-running-query/index.md) · code in `src/features/query-editor/components/editor-run-toolbar.tsx`, `crates/dh-core/src/db/runs.rs`

### 11. Read only and environment labels · done · GA
A connection can be read only (writes refused on every database, from the editor, grid, and schema designer) and carry a coloured environment label shown wherever the connection appears.
spec [0007](../specs/0007-read-only-environment-labels/index.md) · code in `src/features/connections`, `crates/dh-core/src/db/read_only.rs`, `src/shared/components/env-chip.tsx`, `src/shared/hooks/use-write-confirm.tsx`
Skipped: verify, test, review, document.

### 12. Import data · done · GA
Import CSV, JSON, JSON Lines, or Excel into a table or collection (or a new table) with mapping, preview, bad row reports, and a rollback on databases with transactions.
spec [0008](../specs/0008-import-data/index.md) · code in `src/features/data-import`, `crates/dh-core/src/db/import.rs`
Skipped: verify, test, review, document.

### 13. Explain plan viewer · done
An Explain action shows a readable plan tree for PostgreSQL, SQLite, and MongoDB, with Explain Analyze, Stop, and an optional plan after each result.
spec [0011](../specs/0011-explain-plan-viewer/index.md) · code in `src/features/query-editor`, `crates/dh-core/src/db/explain`
Skipped: verify, test.

### 17. Streaming results for Postgres and MongoDB · done
PostgreSQL and MongoDB stream rows as they arrive, the way SQLite does, and stopping keeps the rows already shown.
spec [0011](../specs/0011-stream-postgres-mongo-results/index.md) · code in `crates/dh-core/src/db/stream.rs`, `crates/dh-server/src/routes/stream.rs`, `src/shared/api/streaming.ts`
Skipped: verify, test.

### 28. Split server only code into its own crate · done · Alpha
`src-tauri` no longer compiles server only code: `dh-core` has no server module. Slice 29 finished the job by deleting the in between `dh-server-client` crate.
code in `crates/dh-server`
Skipped: verify.

### 29. Strip the server to a bare no login proxy · done
The server and web UI only connect to databases: an access key and Host check guard it, and every accounts, orgs, grants, and sharing piece is gone from server and desktop.
spec [0010](../specs/0010-bare-no-login-proxy/index.md) · code in `crates/dh-server`, `src/web`, `src-tauri/src/legacy_servers.rs`
Skipped: verify, test.

## Slice 30: Connection form as a two step flow

### 30. Connection form as a two step flow · in-progress
The new connection landing becomes a flow: pick the database first, then a calm single column form for that database, with SSH, SSL, and advanced options reachable without the old tab strip. Editing a saved connection opens straight on its form.
**Done when:** a new connection starts on a database picker with no tabs, Next shows a single column form for that database with only the fields it needs visible by default, SSH, SSL and advanced options are reachable without tabs, Previous returns to the picker keeping what you typed, editing a saved connection opens directly on its form, and Test and Save & Connect work for every database as they do today.
spec [0012](../specs/0012-connection-form-two-step/index.md) · code in `src/features/connections/components`

- [x] Design it (spec): `/architect connection form as a two step flow`
- [x] Build it: `/develop connection form as a two step flow`
  - [x] Lift defaults, payload builders, URL import and validation into tested lib files, plus the drafts hook (AC-8, AC-11, AC-16, AC-17, AC-19, AC-20)
  - [x] Card shell, kind picker, and the PostgreSQL form end to end (AC-1 to AC-5, AC-9, AC-10, AC-12 to AC-15, AC-21, AC-27)
  - [x] MongoDB, DocumentDB and SQLite forms, and edit mode through the new store action (AC-6, AC-7, AC-9, AC-11, AC-12, AC-14, AC-18)
  - [x] Sidebar: select on single click, direct connect, web password prompt, Duplicate opens the form, landing tests rewritten (AC-16, AC-18, AC-22 to AC-26)
- [ ] Verify it: `/check verify connection form as a two step flow`
- [ ] Test it: `/test connection form as a two step flow`

## Slice 5: Table comparison view

### 5. Table comparison view · needs a decision · from spec 0003
Compare two tables side by side, both structure (columns, indexes, and so on) and data (rows), in the same grid format as the review before apply dialog. The design pass settles where the view lives and how it reuses that dialog's grid renderer without its apply and selection behaviour.
**Done when:** picking two tables shows their structural differences and their data differences, in the same grid format the review before apply dialog already uses.

- [ ] Design it (spec): `/architect table comparison view`

## Slice 14: Saved queries and snippets

### 14. Saved queries and snippets
A per connection library of named saved queries and snippets you can search, insert into the editor, edit, and delete, kept across restarts.
**Done when:** you can save the current editor text under a name, find it later from a searchable list, insert it into any editor tab for that connection, and it is still there after restarting the app.
code in `src/features/query-editor`, `src/features/workspace/components/sidebar`

- [ ] Build it: `/develop saved queries and snippets`
- [ ] Verify it: `/check verify saved queries and snippets`
- [ ] Test it: `/test saved queries and snippets`

## Slice 15: Mongo aggregation builder

### 15. Mongo aggregation builder · needs a decision
A visual builder for Mongo pipelines: add stages one by one (match, group, sort, project, lookup, and so on), see each stage's output, and send the pipeline to the editor or the grid. The design pass settles how much of the pipeline language the first cut covers and how stage previews stay cheap on large collections.
**Done when:** you can build a multi stage aggregation for a Mongo collection stage by stage, see the result after each stage, and run or copy the final pipeline.
code in `src/features/table-explorer/components/mongo-collection-pane.tsx`, `crates/dh-core/src/db/mongodb`

- [ ] Design it (spec): `/architect mongo aggregation builder`

## Slice 16: ER diagram

### 16. ER diagram · needs a decision
A diagram of a database or schema: tables as boxes with their columns, joined by foreign keys, and a click opens that table. The design pass settles drawing and layout, how it copes with hundreds of tables, and image export.
**Done when:** opening the diagram for a PostgreSQL or SQLite schema shows its tables and foreign key links, and clicking a table opens it, with a large schema still usable.
code in `src/features/schema-designer`, `src/features/workspace/components/sidebar`

- [ ] Design it (spec): `/architect er diagram`

## Deferred

Out of scope for the current build pass, kept so the plan stays honest.

- **Stopped status in the activity log**: a stopped query is logged as a failed entry with the message "Stopped by user". Give the activity record a real "stopped" status so stopped runs leave the failed filter · from spec 0006 · code in `crates/dh-core/src/activity.rs`
- **Break up the longest backend functions**: the file split moved long functions whole, so MongoDB `run_db_call`, `table_schema`, and `apply_schema_ops_batch` stay long. Cut them by step · from spec 0009 · code in `crates/dh-core/src/db`
- **Row cap and load more for huge results**: streamed results have no row cap, so a runaway SELECT can fill app memory and Stop is the only guard. Add a cap with a load more cursor, and backpressure on the desktop channel, if memory pressure shows up · from spec 0011 · code in `src/shared/api/streaming.ts`, `crates/dh-core/src/db`
- **Import upsert and skip duplicates**: import is insert only, so a clash with an existing key is a bad row. Add Skip duplicates and an Update on duplicate (upsert) mode, with a key to match on and separate Mongo handling · from spec 0008 · code in `src/features/data-import`, `crates/dh-core/src/db/import.rs`
- **Import beyond 200,000 rows**: an import is one request capped at 200,000 rows and 100 MB. Larger loads need an import session that keeps a transaction open across batches, with timeouts and cleanup on desktop and server · from spec 0008 · code in `crates/dh-core/src/db/import.rs`
- **Cancel for web imports**: on the web build an import shows a spinner and cannot be cancelled. The run registry and cancel route exist now, so send `run_id` with the import and turn on Cancel for the web · from spec 0008 · code in `src/shared/api/import.ts`, `crates/dh-server/src/routes`
- **Connection form extras**: the reference design also shows a standalone connection Color, Notes (with Show on the sidebar row), URL Params, Database information (server version after Test) and Select Visible Databases. Each needs its own design pass; Color and Notes need a new saved field · from spec 0012 · needs a decision · code in `src/features/connections`
- **Master password secret storage**: saved connection passwords and SSH secrets live in the OS keychain in release builds, which needs a signed app this project does not have. Move them to encrypted files on disk with one storage path for dev and release, carrying over existing keychain entries. Open question: a master password typed once per launch, or an app managed key with no prompt? · needs a decision · code in `src-tauri/src/local_connections`, `src-tauri/src/secret_file.rs`

## Legend

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured. The decision box is the one whose label ends with `(spec)`.
- **Atomic build tasks live in the spec's** `## Build plan`**, not here**: the scope carries only the milestone rollup, and a done feature keeps just its intent and pointers.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history). You decide when a feature is `done`; at this project's Beta tier, after `/test` is the suggested point.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Alpha`) sets that one feature's rigor above or below the project default; no tag inherits the default (Beta).
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
