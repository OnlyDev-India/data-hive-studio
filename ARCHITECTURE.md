# dh-studio — Architecture Graph Map

Database GUI built with **Tauri 2 + React 19 + TypeScript**, supporting **SQLite** and **PostgreSQL**.

---

## 1. System Layer Graph

```mermaid
flowchart TB
    subgraph FS["Filesystem / DB Servers"]
        SQLITEF[("SQLite files")]
        PGS[("PostgreSQL")]
    end

    subgraph Rust["Tauri Backend · src-tauri/src"]
        CMD["commands.rs<br/>26 IPC handlers"]
        ACTR["activity.rs<br/>ring buffer 500 + events"]
        TRAIT["db/mod.rs<br/>DbAdapter trait"]
        RSQ["db/sqlite.rs"]
        RPG["db/postgres.rs"]
    end

    subgraph Shared["Shared Kernel · src/shared"]
        API["api/client.ts<br/>typed invoke wrappers"]
        ADPT["api/adapters/<br/>sqlite · postgres<br/>SQL query builders"]
        STORE["store/<br/>zustand + persist"]
        GRID["components/data-grid/<br/>virtualized grid · filters<br/>cell editors · keyboard"]
        UI["components/ui + icons"]
        LIB["lib/ platform · runtime · utils"]
        THEME["theme/theme.tsx"]
    end

    subgraph Features["Feature Modules · src/features"]
        CONN["connections<br/>landing · conn-tabs · reopen"]
        WORK["workspace<br/>sidebar · tab-bar"]
        TEX["table-explorer<br/>TablePane data⇄schema"]
        SQLC["sql-console<br/>CodeMirror editor"]
        SCH["schema-designer<br/>drafts → transactional DDL"]
        EXP["data-export<br/>CSV·JSON·SQL·MD·XLSX"]
        INSP["inspector<br/>JSON viewer"]
        ACT["activity<br/>feed + details tab"]
        NOTIF["notifications<br/>bell + popover"]
    end

    subgraph Shell["App Shell · src/app/studio"]
        STUDIO["studio.tsx<br/>providers + layout"]
        APPWS["workspace.tsx<br/>tab router"]
        ACTIONBAR["action-bar.tsx"]
        ACTBAR["activity-bar.tsx"]
    end

    MAIN(["main.tsx"]) --> APPX(["App.tsx"]) --> THEME --> STUDIO
    STUDIO --> APPWS
    STUDIO --> ACTBAR

    %% shell → features
    STUDIO --> CONN & WORK & ACT
    APPWS --> WORK & ACT & TEX & CONN
    APPWS -.lazy.-> SQLC
    APPWS -.lazy.-> SCH
    APPWS -.lazy.-> INSP
    ACTIONBAR --> EXP & NOTIF

    %% feature → feature
    WORK -->|reopenRecent| CONN
    TEX -.lazy.-> SCH

    %% features → shared
    Features --> STORE
    CONN & TEX & SQLC & SCH & EXP & ACT --> API
    TEX & SQLC & APPWS --> GRID
    Features --> UI & LIB

    %% shared internals
    STORE -->|types| API
    API --> ADPT

    %% frontend → backend
    API ==>|"invoke() ×26"| CMD
    CMD --> TRAIT
    TRAIT --> RSQ & RPG
    CMD --> ACTR
    RSQ --> SQLITEF
    RPG --> PGS
    ACTR -.->|"activity://entry events"| ACT
```

---

## 2. Tab Rendering Map

Every open tab is routed by `src/app/studio/workspace.tsx` based on its type in the zustand store:

```mermaid
flowchart LR
    TABBAR["TabBar<br/>drag · reorder · context menu"] --> ROUTER{"workspace.tsx<br/>switch tab.kind"}

    ROUTER -->|"table"| TP["table-explorer<br/>TablePane"]
    ROUTER -->|"sql"| SQLT["sql-console<br/>SqlTab (lazy)"]
    ROUTER -->|"new-table"| NTT["schema-designer<br/>NewTableTab (lazy)"]
    ROUTER -->|"activity-details"| ADT["activity<br/>ActivityDetailsTab"]

    TP -->|"Data mode"| GRID["data-grid"]
    TP -->|"Schema mode"| ST["SchemaTab (lazy)<br/>columns · indexes · triggers · FKs"]
    SQLT --> QRG["QueryResultsGrid<br/>streamed results per statement"]
```

---

## 3. Query Execution Data Flow

```mermaid
sequenceDiagram
    participant UI as Feature UI<br/>(grid/editor/export)
    participant C as api/client.ts
    participant A as adapters (sqlite/pg)
    participant B as commands.rs
    participant D as DbAdapter
    participant DB as SQLite / PostgreSQL
    participant ACT as activity.rs

    UI->>A: QueryDetails (table, where, order…)
    A-->>UI: { sql, params } dialect-built
    UI->>C: executeOp / runSqlStream
    C->>B: invoke("execute_op", …)
    B->>D: adapter.execute_op
    D->>DB: parameterized SQL
    DB-->>D: rows
    alt streaming (large results)
        D-->>C: Channel chunks (500 rows)
        C-->>UI: onChunk → rAF batched render
    end
    B->>ACT: log entry (sql, timing, rows)
    ACT-->>UI: emit activity://entry
    UI->>C: getActivity() hydration
```

---

## 4. State Model

```mermaid
flowchart LR
    subgraph Persisted["localStorage · survives restart"]
        R["recent conns (max 8)"]
        PG["pg.recents ⚠ plaintext pwd"]
        SIDEBAR["sidebar open/width"]
        DARK["darkmode"]
    end

    subgraph Session["zustand StudioStore · memory only"]
        CONNS["live connections"]
        TABS["tabs + filters + limit<br/>pagination + staged edits"]
        SQLTXT["unsaved SQL text"]
        ACTLOG["activity mirror"]
        NOTIFQ["notifications (50)"]
    end

    subgraph Rust["Rust registry · process-bound"]
        REG["open DbAdapter instances"]
        RB["activity ring buffer (500)"]
    end

    Persisted --- Session --- Rust
```

---

## 5. Directory Tree

```
src/
├── app/studio/            # shell: studio, workspace (tab router), action-bar, activity-bar
├── features/
│   ├── activity/          # live command feed + details tab
│   ├── connections/       # landing screen, connection tabs, recent reopen
│   ├── data-export/       # export menu + format writers (xlsx lazy-loaded)
│   ├── inspector/         # JSON tree viewer
│   ├── notifications/     # bell + toast popover
│   ├── schema-designer/   # draft-based DDL editor, new-table wizard
│   ├── sql-console/       # CodeMirror editor, autocomplete, splitter
│   ├── table-explorer/    # TablePane: data grid ⇄ schema tabs
│   └── workspace/         # sidebar (tables/schema/db switchers) + tab bar
└── shared/
    ├── api/               # client.ts (invoke wrappers) + adapters/ (SQL builders)
    ├── components/
    │   ├── data-grid/     # virtualized grid, cell editors, filter-bar, keyboard
    │   ├── ui/            # base-ui wrappers (button, dialog, select, …)
    │   └── icons/
    ├── lib/               # platform, runtime, utils
    ├── store/             # zustand store: connections + workspace slices
    └── theme/             # dark/light provider + CodeMirror tokens

src-tauri/src/
├── main.rs / lib.rs       # entry + command registration
├── commands.rs            # 26 IPC handlers
├── api.rs                 # wire types + SchemaOp rendering
├── activity.rs            # ring buffer + event emitter
└── db/
    ├── mod.rs             # DbAdapter trait
    ├── sqlite.rs          # incl. alter-column rebuild flow
    └── postgres.rs        # schemas/databases, SSL modes, native enums
```

---

## 6. Key Invariants

- **One-way deps:** `shell → features → shared`. Only violation: `workspace → connections` (`reopenRecent`).
- **Adapters are pure builders:** frontend `adapters/` never touch IO — they return `{sql, params}`; Rust owns execution.
- **DDL is atomic:** `apply_schema_ops` runs all draft ops in one backend transaction; grid row edits currently do **not** (parallel independent statements).
- **Streaming everywhere large:** both `run_sql_stream` and `execute_op_stream` chunk via Tauri `Channel`.
- **Lazy boundaries:** `SqlTab`, `SchemaTab`, `NewTableTab`, `JsonViewer`, `Workspace`, `xlsx` writer are code-split.
