//! dh-studio server.
//!
//! Environment:
//!   DH_BIND          bind address (default 0.0.0.0:8080). `PORT` (set by
//!                    Vercel and most PaaS hosts) is used instead when
//!                    present, so the same binary needs no DH_BIND override
//!                    there.
//!   DH_DATABASE_URL / DATABASE_URL   PostgreSQL connection string — required.
//!                    (`DATABASE_URL` is read as a fallback so this works
//!                    zero-config with Neon/Supabase's Vercel Marketplace
//!                    integrations, which inject that name.)
//!   DH_MASTER_KEY    64-char hex key for vault (connection-password)
//!                    encryption. Required in any environment without a
//!                    writable, PERSISTENT local disk (Vercel and most
//!                    serverless hosts) — there, generating and writing a
//!                    fallback key file would silently vanish on the next
//!                    cold start and lock out every stored password. Falls
//!                    back to reading/creating `<DH_DATA_DIR>/master.key`
//!                    only when unset, for traditional self-hosted
//!                    (persistent-volume) deployments.
//!   DH_DATA_DIR      state directory for the master-key fallback file only
//!                    (default ./data) — no longer holds a database file;
//!                    all server state lives in Postgres.
//!   DH_STATIC_DIR    optional directory of the built Web UI served at /
//!   DH_READ_ONLY     set to "1" to disable server-managed CRUD operations
//!   DH_PUBLIC_URL    this server's own externally-reachable base URL, used
//!                    to build the OAuth redirect_uri (default
//!                    http://127.0.0.1:8080 — must be set correctly in any
//!                    real deployment or OAuth callbacks will fail).
//!   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID /
//!   GITHUB_CLIENT_SECRET   OAuth app credentials — sign-in with a provider
//!                    is unavailable until its pair is set.
//!
//! Identity model: every caller is a real user, signed in via OAuth (Google
//! or GitHub — see `dh_core::server::auth`), holding a Bearer session token.
//! Users create/join Organizations and share connections within them —
//! there is no more admin-minted opaque-token model.

use dh_core::server::gateway::Gateway;
use dh_core::server::router::build_router;
use dh_core::server::store::{Store, StoreConfig};
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let data_dir = PathBuf::from(env_or("DH_DATA_DIR", "data"));

    let pg_url = std::env::var("DH_DATABASE_URL")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("DATABASE_URL").ok().filter(|s| !s.is_empty()))
        .expect(
            "DH_DATABASE_URL (or DATABASE_URL) is required — point it at a PostgreSQL instance, \
             e.g. a free Neon or Supabase database",
        );
    let master_key = load_or_create_master_key(&data_dir);

    let store = Store::open(StoreConfig { master_key, pg_url }).await.expect("open store");
    serve(store).await;
}

async fn serve(store: Store) {
    // Vercel (and most PaaS hosts) inject PORT and expect the app to bind
    // it; DH_BIND stays available for anyone who wants an explicit
    // host:port instead (e.g. a non-Vercel self-hosted deployment).
    let bind = match std::env::var("PORT") {
        Ok(port) if !port.is_empty() => format!("0.0.0.0:{port}"),
        _ => env_or("DH_BIND", "0.0.0.0:8080"),
    };

    let configured: Vec<&str> = ["google", "github"]
        .into_iter()
        .filter(|p| dh_core::server::auth::provider_config(p).is_some())
        .collect();
    if configured.is_empty() {
        println!(
            "warning: no OAuth provider configured — set GOOGLE_CLIENT_ID/SECRET and/or \
             GITHUB_CLIENT_ID/SECRET, or nobody will be able to sign in"
        );
    } else {
        println!("OAuth sign-in available via: {}", configured.join(", "));
    }

    let gateway = Arc::new(Gateway::new(store));
    let mut app = build_router(gateway);

    if let Ok(static_dir) = std::env::var("DH_STATIC_DIR") {
        if !static_dir.is_empty() {
            println!("serving web UI from {static_dir} at /");
            app = app.fallback_service(
                tower_http::services::ServeDir::new(&static_dir)
                    .not_found_service(tower_http::services::ServeFile::new(
                        PathBuf::from(&static_dir).join("index.html"),
                    )),
            );
        }
    }

    println!("dh-studio server listening on http://{bind}");
    let listener = tokio::net::TcpListener::bind(&bind).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// See the `DH_MASTER_KEY` doc comment above — the file fallback is only
/// safe when `DH_DATA_DIR` is actually a persistent volume, which is the
/// caller's responsibility to ensure (or avoid, by always setting
/// DH_MASTER_KEY, on any serverless host).
fn load_or_create_master_key(data_dir: &PathBuf) -> [u8; 32] {
    if let Ok(hex_key) = std::env::var("DH_MASTER_KEY") {
        let bytes = hex::decode(hex_key.trim()).expect("DH_MASTER_KEY must be hex");
        assert_eq!(bytes.len(), 32, "DH_MASTER_KEY must decode to 32 bytes");
        return bytes.try_into().unwrap();
    }
    std::fs::create_dir_all(data_dir).expect("create data dir for master-key fallback");
    let key_path = data_dir.join("master.key");
    if key_path.exists() {
        let hex_key = std::fs::read_to_string(&key_path).expect("read master.key");
        return hex::decode(hex_key.trim()).expect("master.key must be hex").try_into().expect("32 bytes");
    }
    let key: [u8; 32] = rand::random();
    std::fs::write(&key_path, hex::encode(key)).expect("persist master.key");
    println!(
        "generated new master key at {} — losing this file makes stored passwords unrecoverable. \
         On a host without a PERSISTENT disk (e.g. Vercel), set DH_MASTER_KEY explicitly instead: \
         a freshly generated file here will vanish on the next cold start and lock out every stored password.",
        key_path.display()
    );
    key
}
