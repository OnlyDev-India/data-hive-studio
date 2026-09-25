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
| 5   | Table comparison view                       | Slice 5  | planned     |
| 10  | Stop a running query                        | Slice 10 | in-progress |
| 11  | Read only and environment labels            | Slice 11 | in-progress |
| 12  | Import data                                 | Slice 12 | in-progress |
| 13  | Explain plan viewer                         | Slice 13 | in-progress |
| 14  | Saved queries and snippets                  | Slice 14 | planned     |
| 15  | Mongo aggregation builder                   | Slice 15 | planned     |
| 16  | ER diagram                                  | Slice 16 | planned     |
| 17  | Streaming results for Postgres and MongoDB  | Slice 17 | in-progress |
| 28  | Split server only code into its own crate   | Slice 28 | in-progress |
| 29  | Strip the server to a bare no login proxy   | Slice 29 | in-progress |




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

Optional Axum REST API and web UI. Today it still carries OAuth sign in, the connection vault and org and permission management; slice 29 strips it to a bare server that only connects to databases. code in `crates/dh-server`

### Q. Native shell · existing

Tauri native shell: app menu, commands, local connection state, activity store, file open. code in `src-tauri`

### R. Command palette · existing

Keyboard driven navigation: filter and open connections, tables, and tabs, run commands. code in `src/app/studio/command-palette.tsx`

## Slice 5: Table comparison view



### 5. Table comparison view · needs a decision · from spec 0003

Compare two existing tables side by side, both their structure (columns, indexes, and so on) and their data (rows), reusing the same grid visual language the diff viewer redesign introduces. Surfaced while designing spec 0003 (diff viewer grid redesign); the redesign deliberately keeps its new grid renderer embedded in `apply-changes-dialog.tsx` rather than extracting it early, so this feature's own design pass needs to settle where the comparison view lives and how it reuses that rendering without the dialog's apply/selection semantics.
**Done when:** picking two tables shows their structural differences and their data differences, in the same grid format the review before apply dialog already uses.

- [ ] Design it (spec): `/architect table comparison view`



## Slice 10: Stop a running query



### 10. Stop a running query · in-progress

Once a query starts in the editor there is no way to stop it, so a slow or runaway query ties up the tab (and the database) until it finishes on its own. Add a Stop button to the editor's run toolbar that cancels the running query for SQLite, PostgreSQL, and MongoDB, including a large result that is still streaming in. Each database cancels in its own way, so the design pass settles how cancel works per backend, what the tab shows afterward, and what happens to rows already streamed.
**Done when:** while a query is running in the editor, a Stop button ends it, the tab shows that it was stopped (not an error), and you can run another query right away, on all three databases.
spec [0006](../specs/0006-stop-running-query/index.md)
code in `src/features/query-editor/components/editor-run-toolbar.tsx`, `crates/dh-core/src/db/mod.rs`

- [x] Design it (spec): `/architect stop a running query`
- [x] Build it: `/develop stop a running query`
  - [x] Thread on SQLite, local: run registry, `run_id`, `sqlite3_interrupt`, Stop button and Stopped tab state, 3 second confirm cap, activity log entry — satisfies AC-1, AC-2, AC-5, AC-9, AC-12, AC-13, AC-16
  - [x] PostgreSQL: dedicated connection per run, pid capture, `pg_cancel_backend` from a separate connection, abandon and detach — satisfies AC-1, AC-2, AC-4, AC-8, AC-13
  - [x] MongoDB SQL editor and console: `comment` tag, `currentOp` plus `killOp`, denied fallback, console Stop and write warning — satisfies AC-3, AC-6, AC-8
  - [x] Run all and closing: Stop all and per tab stop, queued runs cancelled, cancel on tab close or disconnect, Cmd or Ctrl plus period — satisfies AC-7, AC-10, AC-11
  - [x] Team server and web: cancel route, owner or Owner and Admin rule, audit, older server fallback, then a regression pass — satisfies AC-12, AC-14, AC-15
- [x] Verify it: `/check verify stop a running query`
- [x] Test it: `/test stop a running query`



## Slice 11: Read only and environment labels



### 11. Read only and environment labels · in-progress · GA

Nothing on a connection says how careful you should be with it, so a production database looks the same as a scratch one. Let a connection be marked read only (writes are refused, not just warned about) and carry an environment label (for example production, staging, development) with a colour that shows in the sidebar, the tab bar, and the title bar. This builds on the existing dangerous SQL warning. The design pass settles where read only is enforced (it has to hold even for a query typed by hand and for Mongo), and how it behaves for team server shared connections.
**Done when:** a connection marked read only refuses every write from the editor, the grid, and the schema designer with a clear message, and any connection with an environment label shows that label and colour wherever you can see the connection.
spec [0007](../specs/0007-read-only-environment-labels/index.md)
code in `src/features/connections`, `src/features/query-editor/lib/dangerous-sql.ts`, `crates/dh-core/src/db/mod.rs`, `crates/dh-core/src/db/read_only.rs`, `src/shared/api/read-only.ts`, `src/shared/api/env.ts`, `src/shared/components/env-chip.tsx`, `src/shared/hooks/use-write-confirm.tsx`

- [x] Design it (spec): `/architect read only and environment labels`
- [x] Build it: `/develop read only and environment labels`
  - [x] Thread on Postgres, local: `ConnGuard` fields, `ReadOnlyGuard`, `DbError::ReadOnly`, first SQL check, Postgres session lock, Read only switch, lock icon in the sidebar — satisfies AC-1, AC-2, AC-7
  - [x] Guard on every database: full SQL check with bypass tests, structured writes, SQLite open flag, Mongo method allowlist, refusals in the Activity log — satisfies AC-2, AC-3, AC-4, AC-5, AC-7
  - [x] Label and interface: label fields and form, colour tokens and chip, disabled write controls, Production confirm, Reconnect flow — satisfies AC-1, AC-6, AC-8, AC-9, AC-10
- [ ] Verify it: `/check verify read only and environment labels`
- [ ] Test it: `/test read only and environment labels`
- [ ] Review it (fresh model): `/check review read only and environment labels`
- [ ] Document it: `/document read only and environment labels`



## Slice 12: Import data



### 12. Import data · in-progress · GA

Export is covered in five formats, but you cannot bring data back in. Add import: pick a CSV or JSON file (Excel too if it stays cheap), map its columns to a table's columns or a collection's fields, preview what will be written, and load it. Import writes many rows at once, so the design pass settles how it runs (one transaction or in batches), how bad rows are reported, and how it works for Mongo.
**Done when:** you can import a CSV or JSON file into an existing table or collection with a preview and column mapping, see which rows failed and why, and a failed import does not leave a half written table on the databases that support a transaction.
spec [0008](../specs/0008-import-data/index.md)
code in `src/features/data-import`, `src/features/data-export`, `crates/dh-core/src/db/import.rs`

- [x] Design it (spec): `/architect import data`
- [x] Build it: `/develop import data`
  - [x] Thread on SQLite, local: Rust request and report types, SQLite writer with savepoint batches, local command, dialog with CSV and automatic mapping, Roll back mode, Import button in the action bar — satisfies AC-1, AC-2, AC-3, AC-8, AC-9, AC-13, AC-14, AC-18
  - [x] Mapping, checks, reports and formats: full mapping and preview, type checks, Skip and Check, error list and failed rows CSV, encoding, JSON, JSON Lines and Excel — satisfies AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-10, AC-11, AC-15
  - [x] PostgreSQL and new table: Postgres writer with casts and savepoints, then create a table from the file inside the same transaction — satisfies AC-5, AC-8, AC-9, AC-12, AC-14
  - [x] MongoDB: document path, transaction when the server supports it, not atomic warning, Check disabled on a standalone server, `_id` rules — satisfies AC-6, AC-9, AC-10, AC-19
  - [x] Web, cancel and guards: gateway route with the larger body limit, spinner, local progress and Cancel, sidebar entry, read only and Production confirm — satisfies AC-1, AC-13, AC-16, AC-17, AC-20 (the audit and Member role parts are dropped, the server has no accounts for now, see slice 29)
- [ ] Verify it: `/check verify import data`
- [ ] Test it: `/test import data`
- [ ] Review it (fresh model): `/check review import data`
- [ ] Document it: `/document import data`



## Slice 13: Explain plan viewer



### 13. Explain plan viewer · in-progress

There is no way to see how a query will run, which is the first thing you need when a query is slow. Add an Explain action in the editor that runs the database's explain for the current statement and shows the plan in a readable view (a tree with costs and row counts where the database gives them). The design pass settles which databases and which plan formats are covered first, and how Mongo's explain fits the same view.
**Done when:** choosing Explain on a statement in the editor opens a readable plan for it, without running the statement's changes, on PostgreSQL and SQLite, with Mongo covered or clearly marked as a later step.
spec [0011](../specs/0011-explain-plan-viewer/index.md)
code in `src/features/query-editor/components/editor-run-toolbar.tsx`

- [x] Design it (spec): `/architect explain plan viewer`
- [x] Build it: `/develop explain plan viewer`
  - [x] Thread on SQLite and PostgreSQL: plan types, Rust parsers, Explain button, Plan tab tree grid, unsupported and error states — satisfies AC-1, AC-2, AC-3, AC-10, AC-12, AC-17
  - [x] Plan tab polish and bind variables: virtualized tree, stale marking, several statements, shortcut, bind variables dialog — satisfies AC-2, AC-8, AC-9, AC-11, AC-15, AC-16
  - [x] Explain Analyze and Stop: rolled back PostgreSQL analyze, write confirm, read only refusal, run id and stop — satisfies AC-4, AC-5, AC-6, AC-8
  - [x] MongoDB: find, aggregate, count, distinct in the console and SQL editor, queryPlanner and executionStats — satisfies AC-3, AC-4, AC-10
  - [x] Auto plan, Activity log, team server and web: on by default toggle with plan after each result, `explain` log kind, gateway routes and old server fallback — satisfies AC-7, AC-13, AC-14
- [ ] Verify it: `/check verify explain plan viewer`
- [ ] Test it: `/test explain plan viewer`



## Slice 14: Saved queries and snippets



### 14. Saved queries and snippets

Activity history remembers what you ran, and a query can be saved to a file, but there is no library of queries you want to keep and reuse. Add a per connection list of named saved queries and snippets you can search, insert into the editor, edit, and delete, kept across restarts.
**Done when:** you can save the current editor text under a name, find it later from a searchable list, insert it into any editor tab for that connection, and it is still there after restarting the app.
code in `src/features/query-editor`, `src/features/workspace/components/sidebar`

- [ ] Build it: `/develop saved queries and snippets`
- [ ] Verify it: `/check verify saved queries and snippets`
- [ ] Test it: `/test saved queries and snippets`



## Slice 15: Mongo aggregation builder



### 15. Mongo aggregation builder · needs a decision

Mongo queries translate to `find` and `aggregate` in the SQL editor, but building a multi stage pipeline still means writing the JSON by hand. Add a visual builder where you add stages one by one (match, group, sort, project, lookup, and so on), see each stage's output, and send the finished pipeline to the editor or the grid. The design pass settles how much of the pipeline language the first cut covers and how stage previews stay cheap on large collections.
**Done when:** you can build a multi stage aggregation for a Mongo collection stage by stage, see the result after each stage, and run or copy the final pipeline.
code in `src/features/table-explorer/components/mongo-collection-pane.tsx`, `crates/dh-core/src/db/mongodb.rs`

- [ ] Design it (spec): `/architect mongo aggregation builder`



## Slice 16: ER diagram



### 16. ER diagram · needs a decision

There is no picture of how tables relate. Add a diagram view for a database or schema that draws tables as boxes with their columns and joins them by foreign keys, so you can see the shape of the data at a glance and jump from a box to that table. The design pass settles how the diagram is drawn and laid out, how it copes with hundreds of tables, and whether it can be exported as an image.
**Done when:** opening the diagram for a PostgreSQL or SQLite schema shows its tables and foreign key links, and clicking a table opens it, with a large schema still usable.
code in `src/features/schema-designer`, `src/features/workspace/components/sidebar`

- [ ] Design it (spec): `/architect er diagram`



## Slice 17: Streaming results for Postgres and MongoDB



### 17. Streaming results for Postgres and MongoDB · in-progress · from spec 0006

Only SQLite sends rows back as it reads them. PostgreSQL and MongoDB fetch the whole result first and then push it in batches, so a large query shows nothing until it has all loaded, and a stopped query has no partial rows to keep. Make both stream rows as they arrive, the way SQLite does, including the MongoDB SQL translation path. The design pass settles how each engine streams without holding the full result in memory, and how it interacts with the new Stop button.
**Done when:** a large SELECT on PostgreSQL or MongoDB starts showing rows before the query has finished loading, and stopping it keeps the rows already shown.
spec [0011](../specs/0011-stream-postgres-mongo-results/index.md)
code in `crates/dh-core/src/db/postgres`, `crates/dh-core/src/db/mongodb`, `crates/dh-server/src/routes`, `src/shared/api/streaming.ts`

- [x] Design it (spec): `/architect streaming results for postgres and mongodb`
- [ ] Build it: `/develop streaming results for postgres and mongodb`
  - [ ] Thread on Postgres, desktop, SQL editor: shared batcher and chunk protocol, Postgres streaming core with Stop keeping rows, one row accumulator with append only rows, rows kept on a late error, real row counts in the activity log — satisfies AC-1, AC-2, AC-3, AC-4, AC-5, AC-13, AC-19, AC-20, AC-21
  - [ ] MongoDB streaming: one cursor loop with growing columns, SQL editor path with killOp during the stream, console find and aggregate with rows and JSON together — satisfies AC-6, AC-7, AC-8, AC-9, AC-10
  - [ ] Grid loads and export: Mongo page on the cursor loop, Postgres grid on the shared core, grid and export on the accumulator with final columns — satisfies AC-11, AC-12
  - [ ] Team server and web: NDJSON stream routes, cancel route on the run registry, idle refresh and cancel on disconnect, page stream reader, Stop on the web, read only refusals before the first byte — satisfies AC-14, AC-15, AC-16, AC-17, AC-18
- [ ] Verify it: `/check verify streaming results for postgres and mongodb`
- [ ] Test it: `/test streaming results for postgres and mongodb`



## Slice 28: Split server only code into its own crate



### 28. Split server only code into its own crate · in-progress · Alpha

Desktop (`src-tauri`) depends on `dh-core`, and `dh-core` bundles the whole team server module inside it (Axum routes, the gateway, the vault, the store, auth), so every desktop build compiles server only code it never runs. Move the server only pieces out of `dh-core`, keeping only what the desktop client genuinely shares (db adapters, wire types, the client side calls that talk to a remote server) in `dh-core`, so `src-tauri`'s dependency graph shrinks. The design pass settles where the moved code lands (into `dh-server` directly, or a new crate both `dh-server` and `dh-core` depend on for shared wire types), and which of today's `server/` module counts as shared versus server only.
**Done when:** `src-tauri` no longer compiles the Axum route handlers, gateway execution, vault encryption, or store code that only the `dh-server` binary runs, the team server (`dh-server`) still builds and behaves unchanged, and every existing backend test still passes.
spec [0012](../specs/0012-split-server-crate/index.md)
code in `crates/dh-server`, `crates/dh-server-client`, `src-tauri/src/servers`

- [x] Design it (spec): `/architect split server only code into its own crate`
- [x] Build it: `/develop split server only code into its own crate`
  - [x] Scaffold dh-server-client and dh-server's lib.rs, move the client side pieces (crypto, client, profiles, shared wire types) out of dh-core — satisfies AC-1, AC-4, AC-5
  - [x] Split the server only modules (vault, auth, orgs and grants, gateway, store and migrations, router) between the two crates — satisfies AC-1, AC-3, AC-4, AC-6, AC-7
  - [x] Rewire dh-server's main.rs and trim each crate's Cargo.toml, verify the dependency boundary with cargo tree — satisfies AC-1, AC-2, AC-8
  - [x] Full test suite green across all three crates — satisfies AC-3
- [ ] Verify it: `/check verify split server only code into its own crate`



## Slice 29: Strip the server to a bare no login proxy



### 29. Strip the server to a bare no login proxy · in-progress

The team server got too complicated, so for now it does one job: connect to databases. The server and its web UI stay, but everything about people goes: no sign in, no owner claim, no sessions or devices, no orgs, members, invites, groups, grants, roles, audit trail, or shared connection vault. The earlier sign in, orgs and grants plans are dropped and will be rethought from zero later. The desktop app loses its team sharing screens. The design pass settles what the web UI does on first open with no account (how it stores the connections it uses), what stops an open server from being reachable by strangers (a bind address default or a single shared secret), which of the built pieces are deleted versus parked, how the database migrations reset (0002 to 0004 add account and grant tables), and what happens to slices 10, 11 and 12 where they already touched the server.
**Done when:** the server starts with no login, the web UI opens straight to connecting to a database and running queries, no route or screen mentions accounts, orgs, invites, groups, grants or audit, the desktop app has no team sharing screens, and backend and frontend tests pass with the removed code gone.
spec [0010](../specs/0010-bare-no-login-proxy/index.md)
code in `crates/dh-server`, `src-tauri/src/legacy_servers.rs`, `src/shared/api`, `src/web`

- [x] Design it (spec): `/architect strip the server to a bare no login proxy`
- [x] Build it: `/develop strip the server to a bare no login proxy`
  - [x] Thin thread and handle registry: connect route, handles with idle close and cap, quiet reconnect, every data route off the store, Mongo included — satisfies AC-2, AC-3, AC-9, AC-13
  - [x] Guards and web page: access key, Host and Origin check, read only switch, refused fields, startup warnings, the browser saved connection list and key prompt — satisfies AC-4, AC-5, AC-6, AC-7, AC-8, AC-14
  - [x] Delete the server people code, the client crate, the desktop servers module, the sharing screens and the old migrations, plus the one time desktop cleanup — satisfies AC-1, AC-10, AC-11, AC-12
  - [x] Tests, review search, deploy files and all four commands green — satisfies AC-11, AC-15
- [ ] Verify it: `/check verify strip the server to a bare no login proxy`
- [ ] Test it: `/test strip the server to a bare no login proxy`



## Deferred

Out of scope for the current build pass, kept so the plan stays honest.

- **Stopped status in the activity log**: a query stopped with the Stop button is logged as a failed entry with the message "Stopped by user" (spec 0006). Give the activity record and its screen a real "stopped" status so stopped runs stop showing in the failed filter · from spec 0006 · code in `crates/dh-core/src/activity.rs`
- **Break up the longest backend functions**: splitting the files (spec 0009) moves long functions whole, so Postgres `execute_op` (about 290 lines), MongoDB `run_db_call` (about 265), `table_schema` and `apply_schema_ops_batch` stay long. Cut them by step once the file split has landed · from spec 0009 · code in `crates/dh-core/src/db`
- **Row cap and load more for huge results**: streamed results have no row cap (spec 0011), so a runaway SELECT can fill app memory and Stop is the only guard. Add a cap with a load more cursor, and backpressure on the desktop channel, if memory pressure shows up · from spec 0011 · code in `src/shared/api/streaming.ts`, `crates/dh-core/src/db`
- **Import upsert and skip duplicates**: import is insert only, so a clash with an existing key is a bad row (spec 0008). Add a Skip duplicates choice and an Update on duplicate (upsert) mode, with a key to match on and different Mongo handling · from spec 0008 · code in `src/features/data-import`, `crates/dh-core/src/db/mod.rs`
- **Import beyond 200,000 rows**: an import is one request capped at 200,000 rows and 100 MB (spec 0008). Larger loads need an import session that keeps a transaction open across batches, with timeouts and cleanup on desktop and server · from spec 0008 · code in `crates/dh-core/src/db/mod.rs`
- **Cancel and progress for remote imports**: on team server and web connections an import shows a spinner and cannot be cancelled (spec 0008). Once spec 0006's run registry is built, send `run_id` with the import and reuse its cancel route · from spec 0008 · code in `crates/dh-core/src/server/router.rs`
- **Master password secret storage**: saved connection passwords, SSH secrets, and team server tokens live in the OS keychain in release builds, which needs a signed app this project does not have. Move them to encrypted files on disk with one storage path for dev and release, carrying over existing keychain entries. Open question for when you pick it up: a master password typed once per launch, or an app managed key with no prompt (with or without an optional password in Settings)? · needs a decision · code in `src-tauri/src/local_connections.rs`, `src-tauri/src/servers.rs`, `src-tauri/src/secret_file.rs`



## Legend

**The decision box.** Every feature carries exactly one, the sub-task whose label ends with `(spec)`. Its wording varies, so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:


| State                        | Set by                                                                                 | The feature shows                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planned` · needs a decision | `/scope`                                                                               | one box: `Design it (spec): /architect <feature>`                                                                                                                                   |
| `in-progress` (designed)     | `/architect` **at spec capture**                                                       | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it`, `Test it` at Beta); any surfaced follow-up enrolled |
| `in-progress` (building)     | `/develop`                                                                             | milestone sub-boxes tick one by one; code pointer filled                                                                                                                            |
| `in-progress` (verified)     | `/check verify`                                                                        | `Build it` + milestones ticked; `Verify it` ticked                                                                                                                                  |
| `done`                       | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; at this project's Beta tier, after `/test` is the suggested point to call it done                                                |


- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's** `## Build plan`**, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history).
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits the default (Beta).
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.

