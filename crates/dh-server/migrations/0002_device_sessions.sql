-- Device sessions (spec 0010, short lived sessions and devices). One session per
-- person per device, a 15 minute access token that renews from a rotating
-- renewal token, and one time login codes for the sign in hand off. The old
-- single 30 day `sessions` table is dropped, so every old token stops working
-- and each person signs in once.

CREATE TABLE device_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('desktop','web')),
    created_ms BIGINT NOT NULL,
    last_used_ms BIGINT NOT NULL,
    idle_expires_ms BIGINT NOT NULL,
    absolute_expires_ms BIGINT NOT NULL,
    refresh_hash TEXT NOT NULL UNIQUE,
    prev_refresh_hash TEXT,
    rotated_ms BIGINT NOT NULL,
    replay_enc BYTEA,
    UNIQUE (user_id, device_id)
);
CREATE INDEX device_sessions_prev_refresh ON device_sessions (prev_refresh_hash);
CREATE INDEX device_sessions_user_used ON device_sessions (user_id, last_used_ms);

CREATE TABLE access_tokens (
    token_hash TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES device_sessions(id) ON DELETE CASCADE,
    expires_ms BIGINT NOT NULL
);
CREATE INDEX access_tokens_session ON access_tokens (session_id);
CREATE INDEX access_tokens_expires ON access_tokens (expires_ms);

CREATE TABLE login_codes (
    code_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_challenge TEXT NOT NULL,
    expires_ms BIGINT NOT NULL
);

DROP TABLE sessions;
