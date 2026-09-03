//! dh-studio team server.
//!
//! Environment:
//!   DH_BIND        bind address            (default 0.0.0.0:8080 — loopback-only binds are unreachable from outside the container/host)
//!   DH_DATA_DIR    state directory         (default ./data)
//!   DH_DATABASE_URL optional PostgreSQL URL for server state (instead of
//!                  the default SQLite file in DH_DATA_DIR)
//!   DH_MASTER_KEY  64-char hex key for vault encryption; generated and
//!                  persisted to <data>/master.key on first run if absent
//!   DH_STATIC_DIR  optional directory of the built Web UI served at /
//!   DH_READ_ONLY   set to "1" to disable server-managed CRUD operations
//!
//! Subcommands:
//!   reset-admin    wipe every existing admin token and mint a fresh
//!                  multi-device ADMIN token against the existing store
//!
//! Token model:
//!   adm_…  full admin — unlimited devices, full admin-panel access.
//!          Printed ONCE at first server start; rotate via `reset-admin`.
//!   tem_…  team token — scoped to one team name + per-connection grants,
//!          minted by an admin from the UI. Requests must send header
//!          X-Team: <team name> alongside the Bearer token.

use dh_core::server::gateway::Gateway;
use dh_core::server::router::build_router;
use dh_core::server::store::{Store, StoreConfig};
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let data_dir = PathBuf::from(env_or("DH_DATA_DIR", "data"));
    std::fs::create_dir_all(&data_dir).expect("create data dir");

    let master_key = load_or_create_master_key(&data_dir);

    let pg_url = std::env::var("DH_DATABASE_URL").ok().filter(|s| !s.is_empty());
    let store = Store::open(StoreConfig {
        path: data_dir.join("server.db").to_string_lossy().to_string(),
        master_key,
        pg_url,
    })
    .await
    .expect("open store");

    if std::env::args().any(|a| a == "reset-admin") {
        new_admin(store).await;
        return;
    }

    serve(store, &data_dir).await;
}

/// Rotate admin access: invalidate every existing admin device/token and
/// mint a fresh multi-device ADMIN token.
async fn new_admin(store: Store) {
    let code = store.rotate_admin().await.expect("rotate admin");
    println!();
    println!("==========================================================");
    println!(" New ADMIN token (multi-device, server-managed):");
    println!("   {code}");
    println!(" Any number of devices may enroll with it.");
    println!(" All previous admin tokens are now invalidated.");
    println!("==========================================================");
}

async fn serve(store: Store, data_dir: &PathBuf) {
    let _ = data_dir; // reserved for future per-server config files
    let bind = env_or("DH_BIND", "0.0.0.0:8080");

    // Bootstrap: print an adm_ token when the server has no admin yet.
    if let Some(admin_token) = store.ensure_bootstrap_admin().await.expect("bootstrap check") {
        println!();
        println!("==========================================================");
        println!(" First-run ADMIN token (multi-device):");
        println!("   {admin_token}");
        println!(" Use this as the Bearer token when connecting a device from");
        println!(" the web UI (Scope: Admin) or the desktop app.");
        println!(" Rotate later with: dh-server reset-admin");
        println!("==========================================================");
        println!();
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

fn load_or_create_master_key(data_dir: &PathBuf) -> [u8; 32] {
    if let Ok(hex_key) = std::env::var("DH_MASTER_KEY") {
        let bytes = hex::decode(hex_key.trim()).expect("DH_MASTER_KEY must be hex");
        assert_eq!(bytes.len(), 32, "DH_MASTER_KEY must decode to 32 bytes");
        return bytes.try_into().unwrap();
    }
    let key_path = data_dir.join("master.key");
    if key_path.exists() {
        let hex_key = std::fs::read_to_string(&key_path).expect("read master.key");
        return hex::decode(hex_key.trim()).expect("master.key must be hex").try_into().expect("32 bytes");
    }
    let key: [u8; 32] = rand::random();
    std::fs::write(&key_path, hex::encode(key)).expect("persist master.key");
    println!(
        "generated new master key at {} — losing this file makes stored passwords unrecoverable",
        key_path.display()
    );
    key
}
