//! dh-studio proxy server (spec 0010).
//!
//! Environment (all optional):
//!   DH_BIND         listen address (default 127.0.0.1:8080). `PORT`, set by
//!                   most hosting platforms, listens on every interface.
//!   DH_STATIC_DIR   directory of the built web page, served at /
//!   DH_PUBLIC_URL   the public address; its host is allowed in the Host check
//!   DH_READ_ONLY    `1` refuses every write, whatever the browser sends
//!   DH_ACCESS_KEY   shared secret every /v1 call (except /v1/info) must send
//!                   as `Authorization: Bearer <key>`
//!
//! There are no accounts and no state on disk. The browser keeps its saved
//! connections and sends them to `POST /v1/connect`; the server keeps only
//! the live pools, in memory.

use dh_server::config::Config;
use dh_server::routes::{router, spawn_sweeper, AppState};

#[tokio::main]
async fn main() {
    let cfg = Config::from_env();
    for line in cfg.warnings(|v| std::env::var_os(v).is_some()) {
        eprintln!("{line}");
    }
    let bind = cfg.bind.clone();
    let static_dir = cfg.static_dir.clone();
    let state = AppState::new(cfg);
    spawn_sweeper(state.clone());
    if let Some(dir) = &static_dir {
        println!("serving the web page from {dir} at /");
    }
    let app = router(state, static_dir.as_deref());
    println!("dh-studio server listening on http://{bind}");
    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .unwrap_or_else(|e| {
            eprintln!("error: could not listen on {bind}: {e}");
            std::process::exit(1);
        });
    axum::serve(listener, app).await.expect("serve");
}
