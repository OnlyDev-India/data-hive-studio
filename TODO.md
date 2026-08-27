- [x] when creating duplicate table duplicate everything including key types
- [x] when deleting the selectes rows last row remains into the grid but deleted from the db
- [x] allow user to open multiple tables tabs
- [x] in status bar there will be 3 section too just like activitybar|sidebar|edtior, 1st section shows the connections icon, 2nd shows the connection details, 3 we can use for showing the tabs info like show the timing or something for that specific tab into the status activity bar and also show the info move the limit and action button below
- [x] make sidebar resizeable and in activity bar if we click on active icon it'll toggle the sidebar and if closed and clicked on another icon then also open the side bar
- [x] resize columns
- [x] when selecting multiple cells create a net don't add borders on each cells
- [x] when i change the db connection from top tab it should keep all the opened tab info like what filters are applied there, limit, pagination etc..(all info for all opened tabs)
- [x] add context menu on cells
- [x] add json viewier in right sidebar
- [x] add new record button and also add the clone row, different copy options(JSON, SQL, Markdown)
- [x] add transactions based editing like when user edits anything it's should stay show new values in the grid and highlighted and add the the button in status-bar to show all the changes and and when user clicks on commit save it coomit the changes add one more button revert the changes. and add one more option to open the commands in sql editor befor commiting and also give the option to rollback.
- [x] creation of query like insert/update/read should happen at the adapter layer so that we can add those function per adapter not messing the frontend code. there will be a one function where we can pass the detials to create the query.
- [x] if primary key is present then for update/delete create a query will all the values so that user can edit even if primary key is not available.
- [x] tables suggestion in editor
- [x] add new cell type for foreign key and if user clicks on it then open the new tab
- [x] implement the virtualization on grid also
- [x] stream of large data
- [x] add export options
- [x] refactor the code base in feature based folder structure and one is shared which will be share all over the feature so that i'll be easier to understand the code base and add new feature
- [x] give option to edit the schema if possible and but first add the triggers tab too on right side of schema tab
- [x] while creating new table give option to add constraints also or add whatever we need to create a table.
- [x] make tabs dragable, rearrangeable and add context menu like(close, close all, close to the right, close to the left)
- [x] add postgresql support
- [x] add edit cell for each datatype
- [x] from when we create key from the frontend for the devices it should be dhk_ but it's creating inv_ check that and stil not able to connect to second server just on web on desktop I can connect to second server and admin can only connect to one device only
- [x] password is not coming from the server connections so when click on connection it should fetch the password from the server before connecting to db.
- [x] query history
- [ ] add a diff viewer along side of apply with drop down like a preview diff so that user'll see old changes and new changes for tables
- [ ] when cell type is json open another table inside the same table just next to that row(another option is completey create a new table grid and give back option with breadcrumbs
- [ ] ER diagram
- [ ]
- [ ] in server add one check with env like if that env is true then desktop should enable the property to connect to that server it'll be like when it's enable instead of performing the details on desktop app it should perform on the server.

## Postgres roadmap (from Phase 1 planning)

- [x] create/drop database dialogs (with attached-db guard, FORCE drop)
- [x] create/drop schema dialogs (public protected, CASCADE option, active-schema fallback)
- [x] integration tests for database/schema lifecycle (tests/pg_ddl_probe.rs)
- [ ] alter column type/nullability/default — full table-rebuild flow on PG
- [x] alter column type/nullability/default on PG (in-place ALTER COLUMN clauses, no rebuild needed; rename composes)
- [ ] sequences browser
- [ ] extensions browser
- [ ] functions browser
- [ ] roles browser
- [ ] grants/privileges UI
- [ ] materialized view refresh action
- [x] materialized view refresh action (sidebar context menu on matviews)
- [ ] saved connections / pinning (sidebar placeholder)
- [ ] duplicate_table on Postgres (LIKE INCLUDING ALL; FKs not copied)
- [x] duplicate_table on Postgres (`LIKE … INCLUDING ALL` + data copy; PK/indexes survive — FKs excluded by Postgres LIKE semantics)
- [x] parameterized SELECT (run_sql_params) on Postgres adapter (?→$n; callers cast e.g. `?::int`)

## Fixes from code review

- [ ] `color-scheme` not synced with runtime theme toggle — add `color-scheme: light` on `:root` and `color-scheme: dark` on `.dark` in `index.css`, remove inline `style.colorScheme` from `index.html`
- [ ] WebGate `handle_connect` uses `web_${Date.now()}` — duplicate config accumulates in localStorage on every reload; use deterministic ID via `slugifyUrl()` instead
- [ ] Connecting state can hang indefinitely (no fetch timeout/abort); add timeout + "Try a different server" escape from connecting state
- [ ] LeaveConfirm: "Leave page" is the emphasized (default) action — swap to emphasize "Stay on page" instead
