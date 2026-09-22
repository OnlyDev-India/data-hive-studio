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
//!                    to build the OAuth redirect_uri and as the one origin the
//!                    Web UI may return to after sign in (default
//!                    http://127.0.0.1:8080 — must be set correctly in any
//!                    real deployment or OAuth callbacks will fail). Set it to
//!                    the https address in production: the Web UI's renewal
//!                    cookie is only marked Secure then, and the server logs a
//!                    warning at start when it is plain http on a network
//!                    address. The desktop app's loopback address is always
//!                    allowed as a return address.
//!   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, GITHUB_CLIENT_ID /
//!   GITHUB_CLIENT_SECRET   OAuth app credentials — sign-in with a provider
//!                    is unavailable until its pair is set.
//!
//! Identity model: every caller is a real user, signed in via OAuth (Google
//! or GitHub — see `dh_server::auth`), holding a device session: a 15
//! minute access token (`dha_`, sent as a Bearer token) that renews from a
//! renewal token (`dhr_`) which changes on every use. There is one session per
//! device, people can see and end their own, and the server owner can end every
//! session of a person. The sign in redirect carries only a one time login code
//! (never a token), which the app trades with a secret only it knows. The Web UI
//! keeps its renewal token in an HttpOnly cookie, so it must be served from the
//! same origin as this API (this server, or a proxy in front of both).
//! Users create/join Organizations and share connections within them —
//! there is no more admin-minted opaque-token model.
//!
//! Upgrading from a server that used the single 30 day session token: run the
//! new server, the new Web UI build and the new desktop app together. The old
//! `sessions` table is dropped, so every person signs in once on each device
//! (saved servers and orgs stay). An old desktop app fails to sign in to a new
//! server, and a new app shows "This server needs updating" against an old one.
//!
//! A new server is closed. It has no owner, prints a setup code in this log
//! at every start, and refuses to make any account until the first person
//! signs in and enters that code. After that, only people whose verified
//! email an owner or admin invited can get an account. Claim it promptly, and
//! do not share the log of an unclaimed server: the code is derived from the
//! master key, so it is the same at every start until the server is claimed.
//! The database is built by numbered migrations; a database made by an older
//! dh-server is refused at start and left untouched (use an empty database).

use dh_server::gateway::Gateway;
use dh_server::router::build_router;
use dh_server::store::{Store, StoreConfig};
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

    let store = match Store::open(StoreConfig { master_key, pg_url }).await {
        Ok(store) => store,
        Err(e) => {
            // `expect` would print a debug dump; the refusal of an old
            // database is a message an operator has to be able to read.
            eprintln!("error: could not open the server database: {e}");
            std::process::exit(1);
        }
    };
    print_setup_banner(&store).await;
    serve(store).await;
}

/// While the server has no owner, print the setup code. Printed at every
/// start, so an operator who missed it can restart and read it again.
async fn print_setup_banner(store: &Store) {
    match store.is_claimed().await {
        Ok(false) => {
            let bar = "=".repeat(68);
            println!("{bar}");
            println!(" This server has no owner yet, and nobody can sign in until it is claimed.");
            println!(" Sign in from the DH Studio desktop app or the web page, then enter:");
            println!();
            println!("     {}", store.setup_code());
            println!();
            println!(" The code stops working once the server is claimed. Claim it promptly,");
            println!(" and do not share the log of an unclaimed server.");
            println!("{bar}");
        }
        Ok(true) => {}
        Err(e) => eprintln!("warning: could not read the claim state: {e}"),
    }
}

async fn serve(store: Store) {
    // Vercel (and most PaaS hosts) inject PORT and expect the app to bind
    // it; DH_BIND stays available for anyone who wants an explicit
    // host:port instead (e.g. a non-Vercel self-hosted deployment).
    let bind = match std::env::var("PORT") {
        Ok(port) if !port.is_empty() => format!("0.0.0.0:{port}"),
        _ => env_or("DH_BIND", "0.0.0.0:8080"),
    };

    if let Some(warning) =
        dh_server::router::insecure_public_url_warning(&env_or("DH_PUBLIC_URL", "http://127.0.0.1:8080"))
    {
        println!("{warning}");
    }

    let configured: Vec<&str> = ["google", "github"]
        .into_iter()
        .filter(|p| dh_server::auth::provider_config(p).is_some())
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
        // Re-lock permissions in case this file predates the chmod below
        // (written by an older build).
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600));
        }
        let hex_key = std::fs::read_to_string(&key_path).expect("read master.key");
        return hex::decode(hex_key.trim()).expect("master.key must be hex").try_into().expect("32 bytes");
    }
    let key: [u8; 32] = rand::random();
    std::fs::write(&key_path, hex::encode(key)).expect("persist master.key");
    // Whoever reads this file decrypts every stored connection password on
    // the server — restrict it the same way the desktop app's own key file
    // is restricted (`secret_file.rs`), instead of leaving it at the
    // process's default umask.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))
            .expect("chmod master.key");
    }
    println!(
        "generated new master key at {} — losing this file makes stored passwords unrecoverable. \
         On a host without a PERSISTENT disk (e.g. Vercel), set DH_MASTER_KEY explicitly instead: \
         a freshly generated file here will vanish on the next cold start and lock out every stored password.",
        key_path.display()
    );
    key
}
