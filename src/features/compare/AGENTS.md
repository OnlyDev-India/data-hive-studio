# Table comparison view

## Overview

A compare tab puts two tables or collections side by side: the structure diff runs as soon as both sides are picked, the row diff only on "Compare data". Governed by [spec 0018](../../../docs/specs/0018-table-comparison-view/index.md).

## Key files

| File | Owns |
|---|---|
| `components/compare-tab.tsx` | The tab: both side pickers, Swap, Reopen, and the structure section |
| `components/side-picker.tsx` | Connection → database → schema → table pickers for one side, or the "Connection not open" state |
| `components/data-section.tsx` | Key and column pickers, the shared filter, Compare data / Stop, paging, and the result grid |
| `components/file-actions.tsx` | Export (CSV, JSON) and the data sync script, one file run at a time |
| `lib/data-runs.ts` | Per tab run state in a module zustand store (`useRuns`), paging by saved keys |
| `lib/data-setup.ts` | `plan_data`: shared columns, the key (shared primary key or your pick), compared columns, and why a run is blocked |
| `lib/drafts-toward.ts`, `lib/mongo-structure.ts`, `lib/sync-structure.ts` | Structure diff and structure sync ops, SQL and Mongo |
| `lib/refs.ts` | `resolve_ref`: a side's open connection by session id, else by stable key |
| `lib/use-async.ts` | Keyed loader that keeps only the answer for the current key |
| `src/shared/components/diff-grid/` | `RowDiffGrid` and `DdlDiffGrid`, shared with the apply changes review dialog |
| `crates/dh-core/src/db/compare/` | The Rust merge of two key ordered scans; each adapter's `compare.rs` does its side's scan |

## Conventions

- The setup (sides, key columns, excluded columns, filter) lives in the studio store's `compareTabs` and survives a restart; run results live only in `useRuns` and never persist.
- Right reads as "before" and left as "after": every diff is what would change on the right to match the left.
- A change to the sides, key, columns, or filter leaves the last results on screen and highlights Compare data; nothing reruns on its own.
- Rows are compared in Rust on canonical values (`CanonVal`), never on display text. The display text only feeds the grid.
- A side stores both `conn_id` and `conn_key`, so a reopened connection (new session id) still resolves.
- Entry points: the sidebar "Compare with…" item, the activity bar tools menu (`src/app/studio/tools.ts`), and the command palette. No button in the table grid toolbar.

## Gotchas

- React Compiler memoizes the closures passed to `useAsync` and reads their dependencies during render. Inside them, use values that are never null (like the `conn_id` state), never `conn!.id`.
- In `RowDiffGrid`, `null` renders NULL but `undefined` stays blank: the review dialog only carries the columns you touched.

_Drafted by /sync from the introducing change, worth a quick human pass._
