# Scope: DH Studio

A Tauri desktop app for managing SQLite, PostgreSQL, and MongoDB databases, with an optional team server for shared connections and org management.

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
| I   | Team sharing                                | Existing | existing    |
| J   | Settings                                    | Existing | existing    |
| K   | Notifications                               | Existing | existing    |
| L   | Auto updater                                | Existing | existing    |
| M   | Data grid                                   | Existing | existing    |
| N   | Shared query editor components              | Existing | existing    |
| O   | DB adapter layer                            | Existing | existing    |
| P   | Team server                                 | Existing | existing    |
| Q   | Native shell                                | Existing | existing    |
| R   | Command palette                             | Existing | existing    |
| 1   | MongoDB nested schema view                  | Slice 1  | done        |
| 2   | Per tab bottom panel state                  | Slice 2  | done        |
| 3   | Cross connection tab key collisions         | Slice 3  | done        |
| 4   | Diff viewer grid redesign                   | Slice 4  | done        |
| 5   | Table comparison view                       | Slice 5  | planned     |
| 6   | Query editor find and replace               | Slice 6  | done        |
| 7   | Column labels in generated INSERT SQL       | Slice 7  | done        |
| 9   | Update dialog markdown and deferred restart | Slice 9  | done        |
| 10  | Stop a running query                        | Slice 10 | in-progress |
| 11  | Read only and environment labels            | Slice 11 | in-progress |
| 12  | Import data                                 | Slice 12 | in-progress |
| 13  | Explain plan viewer                         | Slice 13 | planned     |
| 14  | Saved queries and snippets                  | Slice 14 | planned     |
| 15  | Mongo aggregation builder                   | Slice 15 | planned     |
| 16  | ER diagram                                  | Slice 16 | planned     |
| 17  | Streaming results for Postgres and MongoDB  | Slice 17 | planned     |
| 18  | Split large backend files                   | Slice 18 | in-progress |
| 19  | Owner claim and invite only accounts        | Slice 19 | planned     |
| 20  | Short lived sessions and devices            | Slice 20 | planned     |
| 21  | Orgs, members and email bound invites       | Slice 21 | planned     |
| 22  | Connection roles and grants with expiry     | Slice 22 | planned     |
| 23  | Groups                                      | Slice 23 | planned     |
| 24  | Proxy only shared connections               | Slice 24 | planned     |
| 25  | Audit trail with retention                  | Slice 25 | planned     |
| 26  | Suspend, rate limits and owner recovery     | Slice 26 | planned     |
| 27  | Personal access tokens                      | Slice 27 | planned     |




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

### I. Team sharing · existing

Team server features: org management, member and invite panels, admin dashboard, audit log viewing. code in `src/features/sharing`

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

Optional Axum REST API: OAuth sign in, encrypted connection vault, org and permission management. code in `crates/dh-server`

### Q. Native shell · existing

Tauri native shell: app menu, commands, local connection state, activity store, file open. code in `src-tauri`

### R. Command palette · existing

Keyboard driven navigation: filter and open connections, tables, and tabs, run commands. code in `src/app/studio/command-palette.tsx`

## Slice 1: MongoDB nested schema view



### 1. MongoDB nested schema view · done

Right now a Mongo collection's schema view (`mongo-schema-editor.tsx`) only shows rename and indexes, and the backend's field inference (`inferred_schema` in `mongodb.rs`) only samples top level field names and their most common type. Show the real nested shape too, so a collection with embedded objects and arrays reads as a proper JSON schema, not a flat field list.
**Done when:** opening a Mongo collection's schema view shows nested object and array fields (not just top level ones) with their inferred types, for realistic embedded documents, without breaking the existing rename/index workflow.
spec [0001](../specs/0001-mongodb-nested-schema-view/index.md) · code in `crates/dh-core/src/db/mongodb.rs`, `src/features/schema-designer/components/schema-tab/fields-tree.tsx`

- [x] Design it (spec): `/architect mongodb nested schema view`
- [x] Build it: `/develop mongodb nested schema view`
  - [x] Backend `field_tree`: `DbAdapter` trait method + `MongoAdapter` override, `mongo_field_tree` Tauri command registered in `lib.rs`, and team server route/command parity — satisfies AC-1, AC-8
  - [x] Frontend wiring: API wrapper + `FieldShape` type, and the new read only tree component replacing the flat "Inferred fields" table — satisfies AC-1
  - [x] Nested inference depth: presence/optional tracking scoped to the parent, array element type union, mixed top level type stays single value — satisfies AC-2, AC-3, AC-4
  - [x] Size guards: 50 key truncation, empty container labels, 6 level depth cap, global node budget — satisfies AC-1, AC-5, AC-6
  - [x] Lazy fetch + caching on the Schema tab, isolated error state, and a regression pass on rename/index/grid headers — satisfies AC-7, AC-9, AC-10
- [x] Verify it: `/check verify mongodb nested schema view`
- [x] Test it: `/test mongodb nested schema view`



## Slice 2: Per tab bottom panel state



### 2. Per tab bottom panel state · done

The bottom panel (the results/JSON split shared by editor, table, and Mongo collection tabs) is one global open or closed flag in the store today, so opening, closing, or resizing it in one tab leaks into every other tab, including ones opened afterward. Give each tab its own independent state.
**Done when:** opening, closing, or resizing the bottom panel in one tab never changes it in any other open tab, whether that tab was opened before or after.
spec [0002](../specs/0002-per-tab-bottom-panel-state.md)

- [x] Design it (spec): `/architect per tab bottom panel state`
- [x] Build it: `/develop per tab bottom panel state`
  - [x] Store shape: widen `bottomPanelOpen` to a connection scoped per tab map, plus active tab resolving convenience wrappers for global chrome — satisfies AC-1, AC-3, AC-4
  - [x] Resize key fix: `useBottomPanelSize` takes `conn_id` too and uses the same composite key for its layout storage, updated at all four call sites — satisfies AC-2, AC-6
  - [x] Wire chrome and existing entry points: title bar toggle, native menu command, grid "view as JSON", JSON viewer close — satisfies AC-1, AC-4, AC-5
  - [x] Verification pass across all six acceptance criteria, including the two connections same tab shape case — satisfies AC-1 through AC-6
- [x] Verify it: `/check verify per tab bottom panel state`
- [x] Test it: `/test per tab bottom panel state`



## Slice 3: Cross connection tab key collisions



### 3. Cross connection tab key collisions · done

`gridBridges`, `schemaEdits`, `schemaPanes`, and `newTables` are keyed by the bare tab key, which does not fold in the connection id for a sql, table, or new table tab. Two different open connections can each have a tab that produces the same key (for example, two "SQL 1" console tabs), so these four maps can leak one connection's handle into another's tab. `jsonRows` already fixed this for its own map by folding the connection id into the key; these four still carry the collision. Surfaced as a follow up while designing spec 0002 (per tab bottom panel state); not part of that spec's own scope.
**Done when:** no two tabs, in the same or different connections, can share an entry in `gridBridges`, `schemaEdits`, `schemaPanes`, or `newTables`, even when their bare tab keys are identical.

- [ ] Design it (spec): `/architect cross connection tab key collisions`



## Slice 4: Diff viewer grid redesign



### 4. Diff viewer grid redesign · done

The shared review before apply dialog (`apply-changes-dialog.tsx`) already shows data grid row edits as a proper grid (`RowDiffGrid`), but schema designer DDL changes still show as text style diff hunks (`DiffHunk`/`DiffLine`, before and after lines with plus/minus signs). Redesign that DDL review into the same grid format, so schema designer and data grid reviews share one visual language.
**Done when:** reviewing a schema designer DDL change (new or altered columns, indexes, and so on) shows a grid formatted diff, not text hunks, with no change to the review before apply flow or the atomic schema transaction behavior, and no regression to the existing row diff grid used for grid edits.
spec [0003](../specs/0003-diff-viewer-grid-redesign.md)

- [x] Design it (spec): `/architect diff viewer grid redesign`
- [x] Build it: `/develop diff viewer grid redesign`
  - [x] Structured DDL diff data: new `DdlDiffSection`/row types, `describe_schema_changes` rewritten to emit them instead of flattened `DiffChange` lines — satisfies AC-2, AC-3
  - [x] New `DdlDiffGrid` renderer in `apply-changes-dialog.tsx` (properties table, structured column table, named+definition table, full width trigger rows) plus the new `ddl` prop — satisfies AC-1, AC-2, AC-3, AC-4
  - [x] Wire both callers end to end: `schema-tab/index.tsx` (SQL) first, then `mongo-schema-editor.tsx` (Mongo) onto the same shape — satisfies AC-1, AC-5, AC-6
  - [x] Cleanup + regression: delete the dead `DiffChange`/`DiffHunk`/`DiffLine` code, confirm `RowDiffGrid` (row edit review) is unaffected — satisfies AC-7, AC-8
- [x] Verify it: `/check verify diff viewer grid redesign`
- [x] Test it: `/test diff viewer grid redesign`



## Slice 5: Table comparison view



### 5. Table comparison view · needs a decision · from spec 0003

Compare two existing tables side by side, both their structure (columns, indexes, and so on) and their data (rows), reusing the same grid visual language the diff viewer redesign introduces. Surfaced while designing spec 0003 (diff viewer grid redesign); the redesign deliberately keeps its new grid renderer embedded in `apply-changes-dialog.tsx` rather than extracting it early, so this feature's own design pass needs to settle where the comparison view lives and how it reuses that rendering without the dialog's apply/selection semantics.
**Done when:** picking two tables shows their structural differences and their data differences, in the same grid format the review before apply dialog already uses.

- [ ] Design it (spec): `/architect table comparison view`



## Slice 6: Query editor find and replace



### 6. Query editor find and replace · done

Right now the query editor's find bar (`editor-search-bar.tsx`) only searches, it has no replace, and no way to match case sensitively or by a regular expression pattern. Add a replace field next to find, plus a case sensitive toggle and a regular expression toggle, so the find bar can match and replace text the way a regular code editor does.
**Done when:** opening find in the query editor lets you turn on case sensitive matching and regular expression matching, and replace the current match or every match, from the same find bar.
code in `src/shared/components/query-editor/editor-search-bar.tsx`, `src/shared/components/query-editor/editor-context-menu.tsx`

- [x] Build it: `/develop query editor find and replace`
- [x] Verify it: `/check verify query editor find and replace`
- [x] Test it: `/test query editor find and replace`



## Slice 7: Column labels in generated INSERT SQL



### 7. Column labels in generated INSERT SQL · done

When a generated INSERT statement is opened in the query editor (for example from the grid's Copy to SQL action), a long row is hard to read since a value's matching column only shows up by position, in the column list far above. Show each column's name as a label right before its value in the VALUES list, the way the reference image shows, so a value reads together with its column without counting position. The statement text itself must stay exactly as it is now, still valid SQL you can run as is, so this has to be a visual label the editor draws, not text written into the statement.
**Done when:** opening a generated INSERT statement in the query editor shows each value in the VALUES list labeled with its column name right beside it, and the statement still runs unchanged when you execute it.
spec [0004](../specs/0004-insert-column-labels.md)
code in `src/shared/components/query-editor/insert-column-labels.ts`, `src/shared/components/query-editor/index.tsx`, `src/features/query-editor/components/editor-run-toolbar.tsx`, `src/features/query-editor/components/editor-tab.tsx`

- [x] Design it (spec): `/architect column labels in generated insert sql`
- [x] Build it: `/develop column labels in generated insert sql`
  - [x] Decoration extension: parse the SQL tab with `sql-parser-cst` (mirroring `sql-lint.ts`) and render one CodeMirror widget label per value, mirroring `inline-diagnostics.ts` — satisfies AC-1, AC-2, AC-3, AC-4, AC-7
  - [x] Wire it into the SQL editor's extensions (not the Mongo console branch) behind a `showInsertLabels` prop — satisfies AC-1, AC-8
  - [x] Per-tab on/off toggle in the editor toolbar, mirroring the existing lint toggle — satisfies AC-5
  - [x] Regression pass: read-only views (Activity tab preview), multi-row VALUES, no-column-list fallback, malformed SQL, and the three existing INSERT-generating code paths left untouched — satisfies AC-6, AC-7
- [x] Verify it: `/check verify column labels in generated insert sql`
- [x] Test it: `/test column labels in generated insert sql`



## Slice 9: Update dialog markdown and deferred restart



### 9. Update dialog markdown and deferred restart · done · from L. Auto updater

The update popup (`update-dialog.tsx`) shows release notes as plain text, so headings, lists, links, and code in the notes appear as raw markdown symbols. Its Skip button hides the title bar update badge for that version for good, and Update & Restart relaunches the app the moment the download finishes, with no chance to save your work first. Render the notes as real markdown, replace Skip with a Later button that only closes the popup and leaves the update button visible, and stop relaunching automatically after the install. Once the update is installed, the same place that offered it (the popup and the title bar badge that opens it) shows a Restart button you press when you are ready. The design pass settles where that Restart state lives so it survives closing the popup, and how release note links and unsafe markup are handled.
**Done when:** the update popup shows release notes as formatted markdown (headings, lists, links, code), offers Later instead of Skip so the update button stays visible in the title bar after closing, and after an install finishes the app does not relaunch by itself but shows a Restart button in the same place until you press it.
spec [0005](../specs/0005-update-dialog-markdown-deferred-restart.md)
code in `src/features/updater/update-dialog.tsx`, `src/features/updater/update-check.ts`, `src/features/updater/release-notes.tsx`, `src/app/studio/title-bar.tsx`, `src-tauri/src/updater.rs`

- [x] Design it (spec): `/architect update dialog markdown and deferred restart`
- [x] Build it: `/develop update dialog markdown and deferred restart`
  - [x] Rust thread: new `updater.rs` with `updater_download` and `updater_install_and_restart`, registered in `lib.rs`, and the quit hook skips restart requests — satisfies AC-3, AC-4, AC-5, AC-8
  - [x] Frontend thread: store phases replace `skippedUpdateVersion`, recheck guard, and the dialog gets Later, Update, Restart now, Retry — satisfies AC-2, AC-3, AC-4, AC-7, AC-8
  - [x] Install on quit: the exit hook installs a waiting update after database cleanup — satisfies AC-6
  - [x] Title bar badge phase states and callout, plus the Restart confirmation when staged edits exist — satisfies AC-2, AC-4, AC-5, AC-11
  - [x] Markdown release notes with the opener plugin for links, then a regression pass (web build, entry points, failure cases) — satisfies AC-1, AC-8, AC-9, AC-10, AC-11
- [x] Verify it: `/check verify update dialog markdown and deferred restart`
- [x] Test it: `/test update dialog markdown and deferred restart`



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
- [ ] Build it: `/develop read only and environment labels`
  - [x] Thread on Postgres, local: `ConnGuard` fields, `ReadOnlyGuard`, `DbError::ReadOnly`, first SQL check, Postgres session lock, Read only switch, lock icon in the sidebar — satisfies AC-1, AC-2, AC-7
  - [x] Guard on every database: full SQL check with bypass tests, structured writes, SQLite open flag, Mongo method allowlist, refusals in the Activity log — satisfies AC-2, AC-3, AC-4, AC-5, AC-7
  - [x] Label and interface: label fields and form, colour tokens and chip, disabled write controls, Production confirm, Reconnect flow — satisfies AC-1, AC-6, AC-8, AC-9, AC-10
  - [ ] Team server and shared connections: migration, Owner or Admin rule, server enforcement, capabilities, stale flag refresh — satisfies AC-11, AC-12, AC-13 (waits for slice 22, the new connection roles, so the Owner or Admin rule becomes a connection admin rule)
  - [ ] Regression pass: reads still work on a read only connection, plus tests across all layers — satisfies AC-14
- [ ] Verify it: `/check verify read only and environment labels`
- [ ] Test it: `/test read only and environment labels`
- [ ] Review it (fresh model): `/check review read only and environment labels`
- [ ] Document it: `/document read only and environment labels`



## Slice 12: Import data



### 12. Import data · in-progress · GA

Export is covered in five formats, but you cannot bring data back in. Add import: pick a CSV or JSON file (Excel too if it stays cheap), map its columns to a table's columns or a collection's fields, preview what will be written, and load it. Import writes many rows at once, so the design pass settles how it runs (one transaction or in batches), how bad rows are reported, and how it works for Mongo.
**Done when:** you can import a CSV or JSON file into an existing table or collection with a preview and column mapping, see which rows failed and why, and a failed import does not leave a half written table on the databases that support a transaction.
spec [0008](../specs/0008-import-data/index.md)
code in `src/features/data-export`

- [x] Design it (spec): `/architect import data`
- [ ] Build it: `/develop import data`
  - [ ] Thread on SQLite, local: Rust request and report types, SQLite writer with savepoint batches, local command, dialog with CSV and automatic mapping, Roll back mode, Import button in the action bar — satisfies AC-1, AC-2, AC-3, AC-8, AC-9, AC-13, AC-14, AC-18
  - [ ] Mapping, checks, reports and formats: full mapping and preview, type checks, Skip and Check, error list and failed rows CSV, encoding, JSON, JSON Lines and Excel — satisfies AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-10, AC-11, AC-15
  - [ ] PostgreSQL and new table: Postgres writer with casts and savepoints, then create a table from the file inside the same transaction — satisfies AC-5, AC-8, AC-9, AC-12, AC-14
  - [ ] MongoDB: document path, transaction when the server supports it, not atomic warning, Check disabled on a standalone server, `_id` rules — satisfies AC-6, AC-9, AC-10, AC-19
  - [ ] Team server, web, cancel and guards: gateway route with the larger body limit, audit, Member role, spinner, local progress and Cancel, sidebar entry, read only and Production confirm — satisfies AC-1, AC-13, AC-16, AC-17, AC-20 (waits for slice 22, so the Member role becomes a connection editor role)
- [ ] Verify it: `/check verify import data`
- [ ] Test it: `/test import data`
- [ ] Review it (fresh model): `/check review import data`
- [ ] Document it: `/document import data`



## Slice 13: Explain plan viewer



### 13. Explain plan viewer · needs a decision

There is no way to see how a query will run, which is the first thing you need when a query is slow. Add an Explain action in the editor that runs the database's explain for the current statement and shows the plan in a readable view (a tree with costs and row counts where the database gives them). The design pass settles which databases and which plan formats are covered first, and how Mongo's explain fits the same view.
**Done when:** choosing Explain on a statement in the editor opens a readable plan for it, without running the statement's changes, on PostgreSQL and SQLite, with Mongo covered or clearly marked as a later step.
code in `src/features/query-editor/components/editor-run-toolbar.tsx`

- [ ] Design it (spec): `/architect explain plan viewer`



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



### 17. Streaming results for Postgres and MongoDB · needs a decision · from spec 0006

Only SQLite sends rows back as it reads them. PostgreSQL and MongoDB fetch the whole result first and then push it in batches, so a large query shows nothing until it has all loaded, and a stopped query has no partial rows to keep. Make both stream rows as they arrive, the way SQLite does, including the MongoDB SQL translation path. The design pass settles how each engine streams without holding the full result in memory, and how it interacts with the new Stop button.
**Done when:** a large SELECT on PostgreSQL or MongoDB starts showing rows before the query has finished loading, and stopping it keeps the rows already shown.
code in `crates/dh-core/src/db/postgres.rs`, `crates/dh-core/src/db/mongodb.rs`

- [ ] Design it (spec): `/architect streaming results for postgres and mongodb`



## Slice 18: Split large backend files



### 18. Split large backend files · in-progress · Alpha

Several backend files have grown very large and each mixes many jobs. The database adapters are the biggest: `mongodb.rs` is about 3400 lines, `postgres.rs` about 3000, `sqlite.rs` about 2100, and `db/mod.rs` about 1400. Past them, a second group sits at 500 to 1000 lines: the team server files (`router.rs`, `vault.rs`, `gateway.rs`, `client.rs`, `orgs.rs`), the native shell files (`servers.rs`, `commands.rs`, `local_connections.rs`), the shared core files (`ssh_tunnel.rs`, `api/common.rs`), and the helpers inside the db folder (`mongo_json.rs`, `mongo_sql.rs`, `runs.rs`). Restructure each one into its own folder of smaller files grouped by job (for an adapter: connecting, running queries, schema work, row edits; for the server: routes grouped by area), so no single file is huge and a change lands in a small, obvious place. This is a move only refactor: behaviour does not change. Run it after slices 10, 11 and 12 land, since they are still editing the db files and splitting first would cause heavy merge conflicts. Slices 19 to 27 then rework the server files inside the smaller layout. The design pass settles the size line that makes a file worth splitting, where to cut each one, whether `db/mod.rs` is included, how the public paths other crates import and the Tauri command names the frontend calls stay unchanged, and whether it lands as one pass or as a few commits by area.
**Done when:** no large backend file is left as one big file (each is a folder of focused files), every existing backend test still passes unchanged, and no code outside the files being split needed a change to keep compiling, including the Tauri commands the frontend calls.
spec [0009](../specs/0009-split-large-backend-files/index.md)
code in `crates/dh-core/src`, `src-tauri/src`

- [x] Design it (spec): `/architect split large backend files`
- [ ] Build it: `/develop split large backend files`
  - [ ] Gate and baseline: slices 10, 11 and 12 merged, fresh branch, saved test lists and size report (waits for those slices, and the spec recommends landing before slice 17) — satisfies AC-4, AC-9
  - [ ] Pilots: Postgres adapter and the Tauri commands, proving the thin trait wrapper, test placement and the handler paths — satisfies AC-1, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8
  - [ ] Rest of the adapters and the shared core: MongoDB, SQLite, `db/mod.rs`, `mongo_json`, `mongo_sql`, `api/common` — satisfies AC-1, AC-3, AC-5, AC-6, AC-7, AC-8
  - [ ] Team server and the rest of the native shell: `router`, `gateway`, `vault`, `client`, `servers`, `local_connections` — satisfies AC-1, AC-3, AC-5, AC-7
  - [ ] Final gate and after merge: size report empty, test lists match, workspace compiles, then `/sync` for the AGENTS.md updates — satisfies AC-1, AC-2, AC-3, AC-4, AC-9, AC-10
- [ ] Verify it: `/check verify split large backend files`



## Slice 19: Owner claim and invite only accounts



### 19. Owner claim and invite only accounts · needs a decision · GA

This starts the team server access rebuild (slices 19 to 27), a fresh start with no migration from the current server, aimed at small self hosted teams first. Today anyone who can reach a new server and sign in with Google or GitHub gets an account. Make a new server start closed: a one time setup code printed in the server log lets the first person claim the server owner role, and after that only invited people get an account. The same person signing in through Google and through GitHub with the same verified email becomes one account (today the second sign in fails, because email must be unique). The design pass settles the account shape, how the server keeps versioned schema changes (today it only creates tables if missing), and what happens with an email a provider has not verified.
**Done when:** a fresh server refuses every sign in until the first person enters the setup code, a stranger who signs in later without an invite gets no account, and one verified email used through Google and GitHub lands in a single account.
code in `crates/dh-core/src/server/auth.rs`, `crates/dh-core/src/server/store.rs`, `crates/dh-server/src/main.rs`

- [ ] Design it (spec): `/architect owner claim and invite only accounts`



## Slice 20: Short lived sessions and devices



### 20. Short lived sessions and devices · needs a decision · GA

Sessions are one 30 day token today, and it travels in a URL back to the desktop app. Replace it with a short token that renews quietly, one session per device. People see their devices and can sign out one or all of them, and the server owner can end every session of a person. This covers both the desktop app and the web UI the server serves. The design pass settles how the token is handed to the desktop app safely, how renewal stays safe if a token is stolen, and where the web page keeps it.
**Done when:** a signed in desktop app and web page keep working past the short token life without signing in again, signing out one device leaves the others alone, sign out everywhere ends every session, and an expired or revoked token is refused.
code in `crates/dh-core/src/server/auth.rs`, `crates/dh-core/src/server/router.rs`, `src-tauri/src/servers.rs`

- [ ] Design it (spec): `/architect short lived sessions and devices`



## Slice 21: Orgs, members and email bound invites



### 21. Orgs, members and email bound invites · needs a decision · GA

Only the server owner creates organizations, and one person can belong to several. Org roles (owner, admin, member) only control people and settings, never database data (that moves to connection roles in slice 22, so today's viewer role goes away). Owners and admins invite by email, bound to that address, or make an optional shareable link with a use limit and an expiry. Removing someone ends their access to that org's connections at once, and the last owner guard stays. The design pass settles the invite delivery (the server may not be able to send email) and how the current invite screens change.
**Done when:** the server owner creates an org and invites a person by email, only that email can redeem the invite, a shareable link stops working after its limit or expiry, removing a person cuts their access at once, and the last owner cannot be removed or demoted.
code in `crates/dh-core/src/server/orgs.rs`, `src/features/sharing`

- [ ] Design it (spec): `/architect orgs members and email bound invites`



## Slice 22: Connection roles and grants with expiry



### 22. Connection roles and grants with expiry · needs a decision · GA

One place decides what a person may do on a shared connection, replacing today's four org roles plus three switch overrides. Each connection has its own roles: viewer (reads), editor (also changes rows and runs writes), admin (also changes schema, settings and who has access). Only org owners and admins add a connection. A new connection is usable by nobody until granted, and an org admin can grant themselves access, which is logged. A grant can carry an end time, and if a person has more than one grant the highest access wins, with no deny rules. Every gateway route asks this same check, and the grant screens are new, since none exist today. The connection wide read only switch from spec 0007 stays separate and beats any role. Slices 10, 11 and 12 finish their team server milestones on this model. The design pass settles how each route maps to a role (SQL console, schema changes, import, Stop), and how an end time is enforced on a connection that is already open.
**Done when:** a new connection is invisible to everyone except org owners and admins until granted, a viewer reads but cannot write, an editor writes rows but cannot change the schema or access, an admin can do both, a grant with an end time stops working at that time, and every route uses the same check.
code in `crates/dh-core/src/server/gateway.rs`, `crates/dh-core/src/server/grants.rs`, `src/features/sharing`

- [ ] Design it (spec): `/architect connection roles and grants with expiry`



## Slice 23: Groups



### 23. Groups · needs a decision · GA

Named groups of people inside an org, managed by org owners and admins. A connection role can be granted to a group, and every member of the group gets it. When a person has both a direct grant and group grants, the highest access wins. The design pass settles how groups sit in the access check from slice 22 so it stays one check, and what removing a group does to the grants it held.
**Done when:** adding a person to a group gives them the group's connection roles at once, removing them takes those roles away, a person in two groups gets the higher role, and deleting a group removes every grant it held.
code in `crates/dh-core/src/server/grants.rs`, `src/features/sharing`

- [ ] Design it (spec): `/architect groups`



## Slice 24: Proxy only shared connections



### 24. Proxy only shared connections · needs a decision · GA

Members should never receive a shared database password. Queries already run through the server, but the `/v1/connections/{id}/credentials` route still hands the decrypted password to anyone with read access, and the sidebar uses it to prefill a local connection form when you click a shared connection. Retire that route and that prefill, and show the details a member may see without the secret. The design pass settles what an admin still needs to see when editing a connection, and how the change reaches web and desktop clients together.
**Done when:** no server route returns a stored password or SSH secret to a member or to an admin who is only viewing, clicking a shared connection still shows its non secret details, and queries, streaming results and Stop keep working through the server.
code in `crates/dh-core/src/server/gateway.rs`, `crates/dh-core/src/server/router.rs`, `src/features/workspace/components/sidebar/home-view.tsx`

- [ ] Design it (spec): `/architect proxy only shared connections`



## Slice 25: Audit trail with retention



### 25. Audit trail with retention · needs a decision · GA

The audit log today is a best effort list of a few actions per org. Record security events (sign ins, invites, role and grant changes, suspensions) long term, and every query with its text for 90 days by default, then clear it, since query text can hold sensitive values. Org owners and admins read their org's trail, and each person can read their own. The design pass settles who sees what, where the retention setting lives, and how the trail stays cheap on a busy server.
**Done when:** every access change and sign in appears in the trail with who did it, every query on a shared connection appears with its text for the retention period and is then removed, and an org admin can filter the trail by person and connection.
code in `crates/dh-core/src/server/store.rs`, `src/features/sharing/components/admin-dashboard.tsx`

- [ ] Design it (spec): `/architect audit trail with retention`



## Slice 26: Suspend, rate limits and owner recovery



### 26. Suspend, rate limits and owner recovery · needs a decision · GA

Three protections for a server that people can reach over the network. The server owner can suspend a person server wide, which ends every session at once without deleting their history. Sign in and invite redemption are rate limited so codes cannot be guessed. A server side command names a new server owner if the only owner loses their Google or GitHub account. The design pass settles where rate limit counts live on hosts that keep no state between requests.
**Done when:** a suspended person is refused everywhere straight away and can be restored, repeated wrong invite codes or sign in attempts get blocked for a while, and the recovery command makes a chosen account the server owner from the server side only.
code in `crates/dh-core/src/server/router.rs`, `crates/dh-core/src/server/auth.rs`, `crates/dh-server/src/main.rs`

- [ ] Design it (spec): `/architect suspend rate limits and owner recovery`



## Slice 27: Personal access tokens



### 27. Personal access tokens · needs a decision · GA

A person can create a token for scripts and CI. It never carries more than its owner, and it can be narrowed when created: chosen connections only, read only, and an expiry. If the owner loses access, the token loses it too, and a suspended owner's tokens stop working. The design pass settles how a token is shown once, stored, and checked alongside the sign in sessions from slice 20.
**Done when:** a person creates a token limited to one connection and read only, a script using it can read that connection and nothing else, revoking the token stops it at once, and removing the owner's access to the connection stops the token too.
code in `crates/dh-core/src/server/auth.rs`, `src/features/sharing`

- [ ] Design it (spec): `/architect personal access tokens`



## Deferred

Out of scope for the current build pass, kept so the plan stays honest.

- **Stopped status in the activity log**: a query stopped with the Stop button is logged as a failed entry with the message "Stopped by user" (spec 0006). Give the activity record and its screen a real "stopped" status so stopped runs stop showing in the failed filter · from spec 0006 · code in `crates/dh-core/src/activity.rs`
- **Break up the longest backend functions**: splitting the files (spec 0009) moves long functions whole, so Postgres `execute_op` (about 290 lines), MongoDB `run_db_call` (about 265), `table_schema` and `apply_schema_ops_batch` stay long. Cut them by step once the file split has landed · from spec 0009 · code in `crates/dh-core/src/db`
- **Import upsert and skip duplicates**: import is insert only, so a clash with an existing key is a bad row (spec 0008). Add a Skip duplicates choice and an Update on duplicate (upsert) mode, with a key to match on and different Mongo handling · from spec 0008 · code in `src/features/data-import`, `crates/dh-core/src/db/mod.rs`
- **Import beyond 200,000 rows**: an import is one request capped at 200,000 rows and 100 MB (spec 0008). Larger loads need an import session that keeps a transaction open across batches, with timeouts and cleanup on desktop and server · from spec 0008 · code in `crates/dh-core/src/db/mod.rs`
- **Cancel and progress for remote imports**: on team server and web connections an import shows a spinner and cannot be cancelled (spec 0008). Once spec 0006's run registry is built, send `run_id` with the import and reuse its cancel route · from spec 0008 · code in `crates/dh-core/src/server/router.rs`
- **Master password secret storage**: saved connection passwords, SSH secrets, and team server tokens live in the OS keychain in release builds, which needs a signed app this project does not have. Move them to encrypted files on disk with one storage path for dev and release, carrying over existing keychain entries. Open question for when you pick it up: a master password typed once per launch, or an app managed key with no prompt (with or without an optional password in Settings)? · needs a decision · code in `src-tauri/src/local_connections.rs`, `src-tauri/src/servers.rs`, `src-tauri/src/secret_file.rs`
- **Company login (SAML or OIDC) and directory provisioning**: sign in through a company's own identity system, with domain rules and people added from its directory. Slices 19 and 20 keep the sign in code open for another provider · from the team server access rebuild · needs a decision · GA · code in `crates/dh-core/src/server/auth.rs`
- **Hosted service for many unrelated orgs**: one server run for many customers, with tenant isolation, plans and billing hooks. Orgs already exist in the model (slice 21) · from the team server access rebuild · needs a decision · GA
- **Access requests with approval**: a member asks for time limited access to a connection and an admin approves it, building on grant expiry (slice 22) · from the team server access rebuild · needs a decision
- **Schema and table level permissions**: rules narrower than one connection, such as one schema only. Slice 22 leaves room in the access model but enforces per connection only · from the team server access rebuild · needs a decision · GA · code in `crates/dh-core/src/server/gateway.rs`
- **Email and password, magic link and Microsoft sign in**: more ways to sign in than Google and GitHub · from the team server access rebuild · needs a decision · GA · code in `crates/dh-core/src/server/auth.rs`



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

