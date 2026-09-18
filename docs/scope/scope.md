# Scope: DH Studio

A Tauri desktop app for managing SQLite, PostgreSQL, and MongoDB databases, with an optional team server for shared connections and org management.

**Build approach:** Tracer Bullet (each feature built end to end through every layer, working).
**Workflow:** Beta (after `/develop`, run `/check verify` then `/test`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· GA`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| A | Connections | Existing | existing |
| B | Table explorer | Existing | existing |
| C | Query editor | Existing | existing |
| D | Schema designer | Existing | existing |
| E | Workspace shell | Existing | existing |
| F | Activity log | Existing | existing |
| G | Data inspector | Existing | existing |
| H | Data export | Existing | existing |
| I | Team sharing | Existing | existing |
| J | Settings | Existing | existing |
| K | Notifications | Existing | existing |
| L | Auto updater | Existing | existing |
| M | Data grid | Existing | existing |
| N | Shared query editor components | Existing | existing |
| O | DB adapter layer | Existing | existing |
| P | Team server | Existing | existing |
| Q | Native shell | Existing | existing |
| R | Command palette | Existing | existing |
| 1 | MongoDB nested schema view | Slice 1 | done |
| 2 | Per tab bottom panel state | Slice 2 | done |
| 3 | Cross connection tab key collisions | Slice 3 | done |
| 4 | Diff viewer grid redesign | Slice 4 | done |
| 5 | Table comparison view | Slice 5 | done |
| 6 | Query editor find and replace | Slice 6 | done |
| 7 | Column labels in generated INSERT SQL | Slice 7 | done |

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
  - code in `src/shared/store/store.ts`, `src/shared/store/types.ts`, `src/shared/store/hooks.ts`, `src/shared/hooks/use-bottom-panel-size.ts`, `src/app/studio/title-bar.tsx`, `src/shared/components/data-grid/grid.tsx`, `src/features/inspector/components/json-viewer/index.tsx`, `src/features/query-editor/components/editor-tab.tsx`, `src/features/table-explorer/components/table-pane.tsx`, `src/features/table-explorer/components/mongo-collection-pane.tsx`
- [x] Verify it: `/check verify per tab bottom panel state`
- [x] Test it: `/test per tab bottom panel state`

## Slice 3: Cross connection tab key collisions

### 3. Cross connection tab key collisions · done
`gridBridges`, `schemaEdits`, `schemaPanes`, and `newTables` are keyed by the bare tab key, which does not fold in the connection id for a sql, table, or new table tab. Two different open connections can each have a tab that produces the same key (for example, two "SQL 1" console tabs), so these four maps can leak one connection's handle into another's tab. `jsonRows` already fixed this for its own map by folding the connection id into the key; these four still carry the collision. Surfaced as a follow up while designing spec 0002 (per tab bottom panel state); not part of that spec's own scope.
**Done when:** no two tabs, in the same or different connections, can share an entry in `gridBridges`, `schemaEdits`, `schemaPanes`, or `newTables`, even when their bare tab keys are identical.
- [x] Design it (spec): `/architect cross connection tab key collisions`

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
  - code in `src/shared/components/apply-changes-dialog.tsx`, `src/features/schema-designer/components/schema-tab/drafts.ts`, `src/features/schema-designer/components/schema-tab/index.tsx`, `src/features/schema-designer/components/mongo-schema-editor.tsx`
- [x] Verify it: `/check verify diff viewer grid redesign`
- [x] Test it: `/test diff viewer grid redesign`

## Slice 5: Table comparison view

### 5. Table comparison view · done · from spec 0003
Compare two existing tables side by side, both their structure (columns, indexes, and so on) and their data (rows), reusing the same grid visual language the diff viewer redesign introduces. Surfaced while designing spec 0003 (diff viewer grid redesign); the redesign deliberately keeps its new grid renderer embedded in `apply-changes-dialog.tsx` rather than extracting it early, so this feature's own design pass needs to settle where the comparison view lives and how it reuses that rendering without the dialog's apply/selection semantics.
**Done when:** picking two tables shows their structural differences and their data differences, in the same grid format the review before apply dialog already uses.
- [x] Design it (spec): `/architect table comparison view`

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

## Legend

**The decision box.** Every feature carries exactly one, the sub-task whose label ends with `(spec)`. Its wording varies, so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it`, `Test it` at Beta); any surfaced follow-up enrolled |
| `in-progress` (building) | `/develop` | milestone sub-boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; at this project's Beta tier, after `/test` is the suggested point to call it done |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history).
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits the default (Beta).
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
