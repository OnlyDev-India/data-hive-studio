# DH Studio

## Stack

- **Language / Runtime**: TypeScript (frontend, React 19), Rust (backend)
- **Framework**: Tauri 2 desktop shell; Axum for the optional `dh-server` team server
- **Key dependencies**: Zustand, Tailwind CSS, CodeMirror, @tanstack/react-virtual
- **Package manager**: Bun

## Build approach

Tracer Bullet (each feature built end to end through every layer, working).

## Commands

```bash
bun install              # install
bun run tauri:dev        # dev server (hot reload)
bun run tauri:build      # production build
bun run lint             # eslint
bun run typecheck        # tsc
bun run test:unit        # frontend tests (vitest)
bun run test             # backend tests (cargo test -p dh-core)
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title.md`.

## Rules

- One-way deps: `shell → features → shared` (only known exception: `workspace → connections`).
- Frontend `adapters/` are pure builders (`{sql, params}`); Rust owns execution.
- Schema DDL is atomic (one transaction); grid row edits are not (independent statements).
- Large results stream back via a Tauri `Channel` in batches, never loaded fully into memory.
- MongoDB is first-class: full CRUD grid editing and the SQL editor, never a stripped mode.
- `tauri.conf.json` is the version source of truth; CI fails if package.json/Cargo.toml drift.

## Context files

- [src/shared/components/data-grid/AGENTS.md](src/shared/components/data-grid/AGENTS.md): the virtualized grid — selection, fill-handle, staged edits
- [crates/dh-core/src/db/AGENTS.md](crates/dh-core/src/db/AGENTS.md): per-backend DB adapters and the Mongo BSON parser/renderer

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
