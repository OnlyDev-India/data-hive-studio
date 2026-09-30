# Scope: DH Studio

A Tauri desktop app for managing SQLite, PostgreSQL, and MongoDB databases, with an optional bare server and web UI that only connect to databases (no login, sharing, orgs or groups for now, see slice 29).

**Build approach:** Tracer Bullet (each feature built end to end through every layer, working).
**Workflow:** Beta (after `/develop`, run `/check verify` then `/test`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· GA`) to do more or less.

*These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use* `/develop` *and skip* `/architect`*. You decide when a feature is* `done`*.*

## At a glance


| #   | Feature                        | Phase    | Status      |
| --- | ------------------------------ | -------- | ----------- |
| A   | Connections                    | Existing | existing    |
| B   | Table explorer                 | Existing | existing    |
| C   | Query editor                   | Existing | existing    |
| D   | Schema designer                | Existing | existing    |
| E   | Workspace shell                | Existing | existing    |
| F   | Activity log                   | Existing | existing    |
| G   | Data inspector                 | Existing | existing    |
| H   | Data export                    | Existing | existing    |
| J   | Settings                       | Existing | existing    |
| K   | Notifications                  | Existing | existing    |
| L   | Auto updater                   | Existing | existing    |
| M   | Data grid                      | Existing | existing    |
| N   | Shared query editor components | Existing | existing    |
| O   | DB adapter layer               | Existing | existing    |
| P   | Team server                    | Existing | existing    |
| Q   | Native shell                   | Existing | existing    |
| R   | Command palette                | Existing | existing    |
| 5   | Table comparison view          | Slice 5  | in-progress |
| 14  | Saved queries and snippets     | Slice 14 | planned     |
| 15  | Mongo aggregation builder      | Slice 15 | planned     |
| 16  | Relation diagram               | Slice 16 | in-progress |




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

## Slice 5: Table comparison view



### 5. Table comparison view · in-progress · from spec 0003

Compare two tables side by side, both structure (columns, indexes, and so on) and data (rows), in the same grid format as the review before apply dialog. The design pass settles where the view lives and how it reuses that dialog's grid renderer without its apply and selection behaviour.
**Done when:** picking two tables shows their structural differences and their data differences, in the same grid format the review before apply dialog already uses.
spec [0018](../specs/0018-table-comparison-view/index.md)
code in `src/features/compare`, `src/shared/components/diff-grid`, `crates/dh-core/src/db/compare`

- [x] Design it (spec): `/architect table comparison view`
- [x] Build it: `/develop table comparison view`
  - [x] Shared diff grid extracted and the compare tab with side pickers, structure diff, and persistence (AC-1, AC-2, AC-3, AC-19, AC-21)
  - [x] Streamed data diff end to end on SQLite, Postgres, and Mongo, with filter, stop, and keyset paging (AC-4 to AC-13, AC-22)
  - [x] Entry points and the activity bar tools menu with pinning, swap, and open row (AC-1, AC-14, AC-18, AC-20)
  - [x] Export, structure sync, and data sync script (AC-15, AC-16, AC-17, AC-22)
- [x] Verify it: `/check verify table comparison view`
- [x] Test it: `/test table comparison view`



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



## Slice 16: Relation diagram



### 16. Relation diagram · in-progress

A diagram of a database or schema: tables as boxes with their columns, joined by foreign keys, and a click opens that table. The design pass settles drawing and layout, how it copes with hundreds of tables, and image export.
**Done when:** opening the diagram for a PostgreSQL or SQLite schema shows its tables and foreign key links, and clicking a table opens it, with a large schema still usable.
spec [0018](../specs/0018-er-diagram/index.md) · code in `src/shared/components/relation-canvas`, `src/features/relation-diagram`, `src/features/table-explorer`, `src/features/workspace/components/sidebar`, `crates/dh-core/src/db`

- [x] Design it (spec): `/architect relation diagram`
- [x] Build it: `/develop relation diagram`
  - [x] SQL diagrams end to end: bulk `schema_graph` for SQLite and Postgres, the diagram tab, schema switcher, stubs, select and open · AC-1, AC-2, AC-3, AC-4, AC-5, AC-7
  - [x] Table tab Diagram mode (one hop) and Open full diagram · AC-9
  - [x] Big schemas and saved layout: column toggle, search, focus mode, positions per schema, saved with the connection's tabs under its stable key · AC-6, AC-8, AC-8a
  - [x] Mongo: streamed sampling, inferred links, collection Diagram mode, palette and activity bar entries · AC-1, AC-10, AC-11, AC-12
  - [x] Export, Refresh, states, activity log, tokens · AC-13, AC-14, AC-15, AC-16, AC-17
  - [x] Rename to Relation diagram (internals and saved tab migration, do first) · AC-13, AC-19
  - [x] Database picker for Postgres and Mongo diagram tabs · AC-18
  - [x] Toolbar always visible, loading and errors on the canvas, toggle decides columns above 0.2 zoom · AC-6, AC-15
  - [x] ER view on SQL: `unique` link flag, entity, oval and diamond shapes, crow's foot marks, the Relation | ER toggle after Focus · AC-7, AC-20, AC-21, AC-22, AC-25, AC-27
  - [x] ER join table fold, clicks, search and focus in ER · AC-23, AC-26
  - [x] ER everywhere and on Mongo: toggle in table and collection Diagram modes, `array` flag, dashed inferred diamonds · AC-20, AC-24
- [ ] Verify it: `/check verify relation diagram`
- [ ] Test it: `/test relation diagram`



## Deferred

Out of scope for the current build pass, kept so the plan stays honest.

- **Stopped status in the activity log**: a stopped query is logged as a failed entry with the message "Stopped by user". Give the activity record a real "stopped" status so stopped runs leave the failed filter · from spec 0006 · code in `crates/dh-core/src/activity.rs`
- **Break up the longest backend functions**: the file split moved long functions whole, so MongoDB `run_db_call`, `table_schema`, and `apply_schema_ops_batch` stay long. Cut them by step · from spec 0009 · code in `crates/dh-core/src/db`
- **Row cap and load more for huge results**: streamed results have no row cap, so a runaway SELECT can fill app memory and Stop is the only guard. Add a cap with a load more cursor, and backpressure on the desktop channel, if memory pressure shows up · from spec 0011 · code in `src/shared/api/streaming.ts`, `crates/dh-core/src/db`
- **Import upsert and skip duplicates**: import is insert only, so a clash with an existing key is a bad row. Add Skip duplicates and an Update on duplicate (upsert) mode, with a key to match on and separate Mongo handling · from spec 0008 · code in `src/features/data-import`, `crates/dh-core/src/db/import.rs`
- **Import beyond 200,000 rows**: an import is one request capped at 200,000 rows and 100 MB. Larger loads need an import session that keeps a transaction open across batches, with timeouts and cleanup on desktop and server · from spec 0008 · code in `crates/dh-core/src/db/import.rs`
- **Compare across engines**: table comparison only pairs tables of the same engine. Postgres vs SQLite (and so on) needs a type mapping layer and looser equality rules · from spec 0018 · code in `crates/dh-core/src/db/compare`
- **Column rename mapping in table comparison**: columns match by name, so a renamed column shows as a drop plus an add, and structure sync would drop it. Add a manual column mapping · from spec 0018 · code in `src/features/compare`
- **Cancel for web imports**: on the web build an import shows a spinner and cannot be cancelled. The run registry and cancel route exist now, so send `run_id` with the import and turn on Cancel for the web · from spec 0008 · code in `src/shared/api/import.ts`, `crates/dh-server/src/routes`
- **Connection form extras**: the reference design also shows a standalone connection Color, Notes (with Show on the sidebar row), URL Params, Database information (server version after Test) and Select Visible Databases. Each needs its own design pass; Color and Notes need a new saved field · from spec 0012 · needs a decision · code in `src/features/connections`
- **Optional master password**: a master password in Settings that locks the slice 31 key, so secrets stay unreadable until you unlock. Changing it locks the key again instead of rewriting every secret; forgetting it loses only the saved secrets. Also the place to move the key into the Keychain once the app has a Developer ID signature · from slice 31 · needs a decision · code in `src-tauri/src/secret_file.rs`, `src/features/settings`
- **Fetch secrets at connect time**: the app loads every saved secret into webview memory at startup (`hydrateSavedLocal`). Fetch each one only when connecting, so secrets aren't held in memory until needed · from spec 0013 · code in `src/shared/store/store.ts`, `src/features/connections/lib/connect-saved.ts`
- **Developer ID signing and notarization**: the only way to a plain double click install with no warning at all on macOS 15 and newer. Needs a paid Apple Developer account; then add the signing and notarization secrets the release workflow already notes, plus a Windows code signing certificate for SmartScreen · from slice 32 · needs a decision · code in `.github/workflows/release.yml`, `src-tauri/tauri.conf.json`
- **Install script lint and uninstall**: run `shellcheck` and PSScriptAnalyzer on the install templates in PR checks, and add an uninstall command if users ask · from spec 0014 · code in `scripts/install`, `.github/workflows/pr-checks.yml`
- **Relation diagram extras**: dismiss or add Mongo inferred links (saved per connection), auto refresh open diagrams after in app DDL, copy as Mermaid `erDiagram`, remember Relation or ER per tab and save ER positions, read Mongo unique indexes, and fold join tables that have extra columns · from spec 0018 · code in `src/shared/components/relation-canvas`, `crates/dh-core/src/db/mongodb`
- **Wider stable connection key**: `stableConnKey` is kind plus database name, so two servers with a same named database share saved tabs, ER layouts and activity history. Widen it to `kind:user@host:port/database` on both the TS and Rust sides, with a one time fallback to the old key · from spec 0018 · code in `src/shared/store/workspace-persistence.ts`, `crates/dh-core/src/db/registry.rs`
- **Grid column layout by stable key**: the grid's column widths and order are keyed by `conn_id`, so they reset on every connect. Move them onto `stableConnKey` · from spec 0018 · code in `src/shared/components/data-grid`
- **Workspace restore on the web build**: the web build saves no workspace snapshot, so tabs and ER layouts are lost on reload · from spec 0018 · code in `src/shared/api/workspace-state.ts`
- **Remove the Keychain carry over**: two minor releases after spec 0013 ships, drop `secret_store/import.rs` and the `keyring` dependency along with the `legacy_servers` cleanup · from spec 0013 · code in `src-tauri/src/secret_store`, `src-tauri/src/legacy_servers.rs`



## Legend

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured. The decision box is the one whose label ends with `(spec)`.
- **Atomic build tasks live in the spec's** `## Build plan`**, not here**: the scope carries only the milestone rollup, and a done feature keeps just its intent and pointers.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history). You decide when a feature is `done`; at this project's Beta tier, after `/test` is the suggested point.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Alpha`) sets that one feature's rigor above or below the project default; no tag inherits the default (Beta).
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.

