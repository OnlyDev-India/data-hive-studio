-- Baseline schema for the team server (spec 0010). A new database is built by
-- this file. A database made by the pre migration server is refused at start
-- (see `Store::guard_old_database`). Never edit an applied migration: add a
-- new numbered file instead.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
    name TEXT NOT NULL,
    avatar_url TEXT,
    server_role TEXT NOT NULL DEFAULT 'member' CHECK (server_role IN ('owner','admin','member')),
    can_manage_roles BOOLEAN NOT NULL DEFAULT FALSE,
    created_ms BIGINT NOT NULL,
    CONSTRAINT users_manage_roles_admin_only CHECK (NOT can_manage_roles OR server_role = 'admin')
);

CREATE TABLE identities (
    provider TEXT NOT NULL CHECK (provider IN ('google','github')),
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_ms BIGINT NOT NULL,
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);
CREATE INDEX identities_user_id_idx ON identities (user_id);

CREATE TABLE server_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    claimed_ms BIGINT,
    claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO server_settings (id) VALUES (1);

CREATE TABLE server_invites (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL CHECK (email = lower(email)),
    created_by TEXT NOT NULL REFERENCES users(id),
    created_ms BIGINT NOT NULL,
    expires_ms BIGINT,
    used_ms BIGINT,
    used_by TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX server_invites_open_email_idx ON server_invites (email) WHERE used_ms IS NULL;

CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_ms BIGINT NOT NULL,
    expires_ms BIGINT NOT NULL,
    last_used_ms BIGINT NOT NULL
);
CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_ms BIGINT NOT NULL
);
CREATE TABLE org_members (
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
    joined_ms BIGINT NOT NULL,
    PRIMARY KEY (org_id, user_id)
);
CREATE TABLE org_invites (
    code TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
    created_by TEXT NOT NULL REFERENCES users(id),
    max_uses INTEGER,
    uses_count INTEGER NOT NULL DEFAULT 0,
    expires_ms BIGINT,
    created_ms BIGINT NOT NULL
);
CREATE TABLE connections (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'postgres',
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 5432,
    "user" TEXT NOT NULL,
    password_enc BYTEA NOT NULL,
    database TEXT NOT NULL,
    ssl_mode TEXT,
    auth_db TEXT,
    srv INTEGER NOT NULL DEFAULT 0,
    tls INTEGER NOT NULL DEFAULT 0,
    ssl_ca_file TEXT,
    ssl_client_cert_file TEXT,
    ssl_client_key_file TEXT,
    retry_writes INTEGER NOT NULL DEFAULT 0,
    replica_set TEXT,
    pool_max INTEGER,
    pool_min INTEGER,
    connect_timeout_secs INTEGER,
    idle_timeout_secs INTEGER,
    max_lifetime_secs INTEGER,
    server_selection_timeout_secs INTEGER,
    ssh_host TEXT,
    ssh_port INTEGER,
    ssh_user TEXT,
    ssh_auth_mode TEXT,
    ssh_key_file TEXT,
    ssh_host_key_fingerprint TEXT,
    ssh_secrets_enc BYTEA,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_ms BIGINT NOT NULL,
    updated_ms BIGINT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE connection_grants (
    conn_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_read INTEGER NOT NULL DEFAULT 0,
    can_update INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conn_id, user_id)
);
CREATE TABLE audit (
    id BIGSERIAL PRIMARY KEY,
    ts_ms BIGINT NOT NULL,
    org_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT
);
