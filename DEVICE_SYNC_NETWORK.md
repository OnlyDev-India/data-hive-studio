# dh-studio — Three-Build Plan

One codebase → three deployable builds:

| #   | Build       | What it is                                                                                                                                                                                                                                   | Run command                                 |
| --- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | **Desktop** | Full Tauri app (studio + local DBs). Saves server profiles locally; **dropdown to connect** to any of them. Server-stored connections appear alongside local ones in the sidebar (queries via gateway). Never runs the backend inside itself | `bun run tauri dev` / `bun run tauri build` |
| 2   | **Web UI**  | Same React SPA, browser-only build. **Full studio against shared connections via the server's query gateway** + admin console                                                                                                                | `bun run build:web` → `dist-web/`           |
| 3   | **Server**  | Headless backend: sync/admin API, persistent encrypted vault, **query gateway** (executes queries against shared PG connections for web AND desktop clients). Docker-deployable                                                              | `cargo run -p dh-server` / Docker           |

**Scope rule:** shared PostgreSQL connection details live ONLY on the server (encrypted at rest) — never downloaded to devices, ever. Clients (web or desktop) authenticate, see granted connection _metadata_, and run queries through the gateway. Local desktop connections stay purely local.

---

## Architecture

```
┌──────────────────────┐      ┌───────────────────────────┐
│ BUILD 1: Desktop     │      │ BUILD 3: Server (Docker)  │
│ Tauri app            │HTTPS │ dh-server                 │
│ ─ local SQLite + PG  │◄────►│ ─ REST + WS API (/v1/*)   │
│ ─ saved server       │ WSS  │ ─ encrypted vault (pg     │
│   profiles (keychain)│      │   details NEVER leave)    │
│ ─ sidebar shows BOTH:│      │ ─ device enrollment+grants│
│   local + server     │      │ ─ admin API               │
│   conns (per server) │      │ ─ query GATEWAY: executes │
└──────────┬───────────┘      │   client queries on shared│
           │ local conns      │   PGs (granted, audited,  │
           ▼ run locally      │   RO/RW)                  │
     [local SQLite/PG]        │ ─ optional: serve dist-web│
                              └─────────▲────┬────────────┘
                                   HTTPS│    │ queries (grants
                                        │    ▼ checked per op)
                              ┌─────────┴─────────────┐
                              │ BUILD 2: Web UI       │
                              │ full studio in browser│
                              │ against shared conns  │
                              │ + admin console       │
                              └───────────────────────┘
        (desktop can hold MULTIPLE server profiles; one active session each)

### Desktop server-connection semantics

| Concern | Behavior |
|---|---|
| Server profiles | Saved locally (name + URL + token in **OS keychain**) — no toggle; a dropdown lists them, plus "Add server…" form |
| Connect | Pick profile → session established → server's granted connections stream into sidebar under that server's group |
| Sidebar | Two sources side by side: `Local` group (today's behavior) + one group per connected server. Open/query any DB from either |
| Queries | Local conns → execute locally. Server-stored conns → execute via gateway (details never leave server) |
| Admin | Extra sidebar icon appears only when the active session carries admin scope → in-app admin UI (devices, grants, invites) |
| Disconnect | Server connections vanish; locals untouched |
```

### Desktop toggle semantics

_Replaced by the server-connection semantics above — no toggle; dropdown of saved server profiles._

| State                             | Behavior                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **No server connected** (default) | All features work locally as today                                                                                                     |
| **Server session active**         | Granted connection metadata fetched live; server conns grouped in sidebar; queries proxied through gateway; admin icon if scope allows |

---

## Code layout

```
Cargo workspace (root Cargo.toml)
├── crates/
│   ├── dh-core/        # moved from src-tauri/src/db: DbAdapter trait,
│   │                   #   sqlite.rs, postgres.rs, wire types
│   │                   # NEW server/: vault.rs (encrypted store),
│   │                   #   grants.rs, identity.rs (enroll/tokens),
│   │                   #   router.rs (axum REST+WS), gateway.rs,
│   │                   #   client.rs (typed HTTP client for desktop)
│   └── dh-server/      # thin bin: config, binds router publicly,
│                       #   optional static SPA dir, Dockerfile
├── src-tauri/          # desktop shell: Tauri IPC → dh-core (local ops)
│                       #   + sync client commands (remote ops)
└── src/                # one React frontend, two transports
    └── shared/api/client.ts   # same signatures;
                               #   TauriTransport | HttpTransport(isTauri())
```

### Frontend build targets

| Target                                   | Transport                     | Notes                                          |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------- |
| `bun run dev` / `build` (desktop bundle) | TauriTransport (IPC)          | current behavior unchanged                     |
| `bun run build:web` → `dist-web/`        | HttpTransport(`VITE_API_URL`) | hides local-file features via `isTauri()` gate |

---

## Phases

### Phase 0 — Workspace refactor (no behavior change)

- Root `Cargo.toml` workspace; move `db/*` + wire types into `crates/dh-core`
- `src-tauri` consumes `dh-core`; verify desktop flows unchanged
- **Exit criteria:** `bun run tauri dev` works identically

### Phase 1 — Server core (`dh-core/src/server/`)

- `vault.rs`: server-side SQLite store — `{id, name, host, port, user, db, payload(password encrypted), created_by, timestamps, archived}` — no replication to devices, so no LWW/site_id machinery needed
- `grants.rs`: two dimensions per grant — **data access** `{device_id → conn_ids → readonly|readwrite}` checked before metadata listing AND before every gateway op, and **edit access** (`can_edit_details`) allowing the holder to modify a connection's stored details (host/port/user/password/name) via `PUT /v1/connections/:id`; admins implicitly hold edit on everything
- `identity.rs`: device keypair + enrollment (one-time invite code → device token), admin scope flag
- `gateway.rs`: PG pool cache per shared connection; executes ops via dh-core adapters; enforces grants per query
- `router.rs`: axum Router — `POST /v1/devices/enroll`, `/v1/auth/login` (admin), `GET /v1/connections` (granted metadata only), `POST /v1/query/:conn_id` (+stream), `PUT /v1/connections/:id` (edit access required), `/v1/admin/*`
- `client.rs`: typed HTTP client used by the desktop app

### Phase 2 — Server binary (`crates/dh-server`)

- Config via env/file: bind addr, data dir, `DH_MASTER_KEY`, optional static dir
- First-boot admin bootstrap token; invite-code enrollment; grant management API
- Audit log of every sync event and every gateway query
- Dockerfile; `bun run server` script

### Phase 3 — Desktop integration (server profiles live here)

- **Server dropdown** in action bar: saved profiles + "Add server…" (URL + invite code or login) → token stored in **OS keychain**
- Multiple saved profiles; connect/disconnect per profile
- Sidebar: `Local` group (unchanged) + one collapsible group per connected server listing its granted connections; opening one routes queries through the gateway transparently (same grid/console UX)
- New commands: `servers_list/add/remove/connect/disconnect/status`, plus passthrough query commands for server conns
- Admin: extra sidebar icon rendered only when session has admin scope → in-app devices/grants panels

### Phase 4 — Web UI build target

- Complete `HttpTransport` (REST + WS streaming equivalents of all 26 calls)
- **Full studio in browser:** table explorer, data grid editing, SQL console, schema designer, exports — all running against gateway-executed shared connections; local-file features hidden via `isTauri()` gate
- Admin console pages (reuse Phase 3 components); catalog view of shared connections
- `build:web` script, `VITE_API_URL` wiring; dh-server optionally serves `dist-web/`

### Phase 5 — NAT traversal option (kept, future)

- `iroh` transport behind the existing `SyncClient` abstraction so two desktops behind home Wi-Fi can sync without a reachable address; invites carry iroh node id + HTTP fallback

---

## Security model

TLS everywhere (reverse proxy in front of server) · per-device tokens · vault payloads encrypted at rest (device key locally, `DH_MASTER_KEY` on server) · one-time invite codes · revocable devices (kills access immediately) · grants checked server-side before any payload leaves **and before every gateway query (table list + readonly/readwrite)** · **connection-detail edits require explicit edit-access on the token** (admins implicit) and are audit-logged with before/after diff · gateway credentials never leave the server — clients only ever see connection names/metadata · audit trail for every sync event, executed query, and detail edit · migrate existing plaintext `pg.recents` into keychain while touching credentials.

## Verification

- `cargo test` workspace: LWW merge, tombstone propagation, grant enforcement (deny unshared items), encryption roundtrip, version-conflict rejection
- Integration: boot server on random port → enroll two clients → share conn on A → appears on B → revoke → disappears; offline queue flush test
- Gateway: web client queries shared conn per grants; RO grant rejects writes; revoked device's in-flight session terminated; query audit entries recorded
- Builds: desktop regression after Phase 0/3; `build:web` renders full studio against local dh-server + real PG; Docker image runs + serves SPA
