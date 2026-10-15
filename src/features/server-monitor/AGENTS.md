# Live server monitor

## Overview

A `Monitor` tab per Postgres or MongoDB connection that polls the server on its own and shows sessions, running queries, locks, and slow queries, with Cancel, Terminate (Postgres) or Kill operation (Mongo) behind a confirm. Governed by [spec 0025](../../../../app-docs/specs/0025-live-server-monitor/index.md).

## Key files

| File | Owns |
|---|---|
| `components/monitor-tab.tsx` | The tab: header, rate picker, banners, Sessions and Locks views, the detail pane |
| `components/sessions-table.tsx`, `components/monitor-filters.tsx`, `components/stats-strip.tsx` | The session list, its filters, and the counts strip |
| `components/locks-view.tsx`, `lib/locks.ts` | The Postgres blocking tree (`buildBlockingTree`), built from the whole snapshot, not the filtered list |
| `components/session-detail.tsx`, `lib/open-and-run.ts` | The detail pane, and Open in editor / Explain (opens a SQL tab and runs it once it registers) |
| `lib/use-monitor-poll.ts` | The poller: never overlaps, pauses after `MAX_FAILURES` failures, stops on an unavailable answer (`blocked`) |
| `lib/use-kill.tsx` | Kill confirms (stronger on Production) and the call to `monitorKill` |
| `lib/sessions.ts` | Filtering, labels, durations, and `MAX_MONITOR_ROWS` |
| `src/shared/api/monitor.ts` | `canMonitor`, the snapshot and kill calls, `MONITOR_UNAVAILABLE_PREFIX` |
| `src/shared/store/monitor-settings.ts` | Saved rate, slow threshold, and show idle per connection (`SavedWorkspace.monitorSettings`) |
| `crates/dh-core/src/db/monitor.rs` | The engine shared Rust side: pool naming, row cap, counts, run links; each backend's `monitor.rs` does its own read and kill |
| `src-tauri/src/commands/monitor.rs`, `crates/dh-server/src/routes/monitor.rs` | The desktop commands and the two web routes (`DH_READ_ONLY` refuses kills) |

## Conventions

- Only Postgres and MongoDB get a monitor (`canMonitor`). A new engine needs its own `monitor.rs` in its backend folder plus a `canMonitor` entry.
- Filters only filter the last snapshot again; they never send a new request.
- Constants kept in step across Rust and TypeScript: `MAX_MONITOR_ROWS` (`lib/sessions.ts` and `db/monitor.rs`) and `MONITOR_UNAVAILABLE_PREFIX` (`shared/api/monitor.ts` and `db/monitor.rs`). Change both or neither.
- A "cannot monitor this server" answer is an error whose text starts with `MONITOR_UNAVAILABLE_PREFIX`; the tab shows it as a stop, not a failed refresh.
- Missing privileges never fail a snapshot: the server returns what the user can see with `visibility.level = partial` and the missing privilege names, and the UI shows a banner and disables kill actions it cannot use.
- Killing one of this launch's own console runs goes through the Stop registry (`runs::cancel_with_source`), never a raw server kill.

## Gotchas

- Pools name themselves `DH Studio (<tag>)` in plain ASCII so `This app` can match them; Postgres turns any other character in `application_name` into `?`.
- Every Mongo snapshot carries `comment: "dh-monitor"` so it can drop its own read from the list.

_Drafted by /sync from the introducing change, worth a quick human pass._
