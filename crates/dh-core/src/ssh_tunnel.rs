//! SSH tunneling: opens a local TCP listener that forwards every connection
//! made to it, through an authenticated SSH session, to a remote host:port
//! — the same thing `ssh -L <local>:<target-host>:<target-port> user@host`
//! does. The Postgres/MongoDB adapter then just points its driver at
//! `127.0.0.1:<local_port>` instead of the real database host, and the
//! whole thing is invisible to the driver.
//!
//! Runs wherever the actual DB connection is made — the desktop app for a
//! local connection, or the team-server for a shared one — with no special
//! casing needed: `SshConfig` is just another field on `PgParams`/
//! `MongoParams`, so it naturally executes on whichever side calls
//! `PgAdapter::connect`/`MongoAdapter::connect`, same as every other
//! connection parameter (host, ssl_mode, ...).

use russh::client::{self, Handle};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::ChannelMsg;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SshConfig {
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    pub user: String,
    /// "password" | "key". Anything else falls back to password auth.
    pub auth_mode: String,
    pub password: Option<String>,
    /// Path to a private key file (Postgres/MongoDB style — read wherever
    /// the tunnel runs, not uploaded from the caller).
    pub key_file: Option<String>,
    /// Passphrase for an encrypted key file. `None`/empty for an
    /// unencrypted one.
    pub key_passphrase: Option<String>,
    /// Trust-on-first-use host key pin (`SHA256:<base64>`, the same format
    /// `ssh-keygen -lf` prints) — `None` accepts whatever key the server
    /// presents and the caller should persist the fingerprint `open_tunnel`
    /// returns; `Some` rejects a connection whose key doesn't match,
    /// protecting against a silently swapped/MITM'd host after the first
    /// successful connect (the same guarantee a normal `ssh` client's
    /// `known_hosts` file gives you).
    #[serde(default)]
    pub host_key_fingerprint: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

/// A live local port-forward. Holds the SSH session and its accept loop
/// alive for as long as this is kept around — drop it to tear the tunnel
/// down. Always keep this alongside whatever's using `local_port`; nothing
/// else keeps the tunnel open.
#[derive(Debug)]
pub struct LocalTunnel {
    pub local_port: u16,
    /// The fingerprint actually presented by the server this connect —
    /// same as the input `host_key_fingerprint` when one was pinned; the
    /// newly-observed one (to persist for next time) when this was a
    /// trust-on-first-use connect.
    pub host_key_fingerprint: String,
    accept_task: tokio::task::JoinHandle<()>,
}

impl Drop for LocalTunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

struct TofuHandler {
    fingerprint_tx: Option<tokio::sync::oneshot::Sender<String>>,
}

impl client::Handler for TofuHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // Always accept here and let `open_tunnel` do the actual pin
        // comparison after the handshake completes: rejecting from inside
        // this callback instead would fail the handshake itself, surfacing
        // russh's generic "Unknown server key" error and losing the
        // specific, actionable mismatch message below.
        let fingerprint = server_public_key
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        if let Some(tx) = self.fingerprint_tx.take() {
            let _ = tx.send(fingerprint);
        }
        Ok(true)
    }
}

/// Connect to the SSH server, authenticate, and start forwarding a fresh
/// local TCP port to `target_host:target_port` for as long as the returned
/// `LocalTunnel` is kept alive.
pub async fn open_tunnel(
    config: &SshConfig,
    target_host: &str,
    target_port: u16,
) -> Result<LocalTunnel, String> {
    let (fingerprint_tx, fingerprint_rx) = tokio::sync::oneshot::channel();
    let handler = TofuHandler { fingerprint_tx: Some(fingerprint_tx) };

    let russh_config = Arc::new(client::Config::default());
    let mut session: Handle<TofuHandler> =
        client::connect(russh_config, (config.host.as_str(), config.port), handler)
            .await
            .map_err(|e| format!("ssh: couldn't connect to {}:{}: {e}", config.host, config.port))?;

    let host_key_fingerprint = fingerprint_rx
        .await
        .map_err(|_| "ssh: connection closed before the host key was received".to_string())?;
    if let Some(expected) = &config.host_key_fingerprint {
        if expected != &host_key_fingerprint {
            return Err(format!(
                "ssh: the host key for {}:{} doesn't match the saved fingerprint ({expected}) — \
                 it presented {host_key_fingerprint} instead. This usually means the server was \
                 reinstalled, or someone is intercepting the connection. If you're sure this \
                 change is expected, clear the saved SSH host key and reconnect to re-pin it.",
                config.host, config.port,
            ));
        }
    }

    authenticate(&mut session, config).await?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("ssh tunnel: couldn't bind a local port: {e}"))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();

    let session = Arc::new(Mutex::new(session));
    let target_host = target_host.to_string();
    let accept_task = tokio::task::spawn(async move {
        loop {
            let Ok((stream, originator)) = listener.accept().await else {
                break;
            };
            let session = session.clone();
            let target_host = target_host.clone();
            tokio::task::spawn(async move {
                if let Err(e) =
                    proxy_one(&session, stream, originator, &target_host, target_port).await
                {
                    log::warn!("ssh tunnel: connection dropped: {e}");
                }
            });
        }
    });

    Ok(LocalTunnel { local_port, host_key_fingerprint, accept_task })
}

async fn authenticate(session: &mut Handle<TofuHandler>, config: &SshConfig) -> Result<(), String> {
    let result = if config.auth_mode == "key" {
        let key_file = config
            .key_file
            .as_deref()
            .filter(|p| !p.is_empty())
            .ok_or("ssh: a private key file is required for key authentication")?;
        let key = load_secret_key(key_file, config.key_passphrase.as_deref().filter(|p| !p.is_empty()))
            .map_err(|e| format!("ssh: couldn't load private key {key_file}: {e}"))?;
        let hash_alg = session
            .best_supported_rsa_hash()
            .await
            .map_err(|e| e.to_string())?
            .flatten();
        session
            .authenticate_publickey(&config.user, PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg))
            .await
            .map_err(|e| format!("ssh authentication failed: {e}"))?
    } else {
        session
            .authenticate_password(&config.user, config.password.as_deref().unwrap_or_default())
            .await
            .map_err(|e| format!("ssh authentication failed: {e}"))?
    };
    if !result.success() {
        return Err("ssh: the server rejected these credentials".into());
    }
    Ok(())
}

/// Proxy one accepted local connection through a fresh SSH direct-tcpip
/// channel — one channel per local TCP connection, all multiplexed over the
/// same SSH session, exactly like `ssh -L` does for however many
/// connections the driver's pool opens.
async fn proxy_one(
    session: &Arc<Mutex<Handle<TofuHandler>>>,
    mut stream: TcpStream,
    originator: SocketAddr,
    target_host: &str,
    target_port: u16,
) -> Result<(), String> {
    let mut channel = {
        let session = session.lock().await;
        session
            .channel_open_direct_tcpip(
                target_host.to_string(),
                target_port as u32,
                originator.ip().to_string(),
                originator.port() as u32,
            )
            .await
            .map_err(|e| e.to_string())?
    };

    let mut stream_closed = false;
    let mut buf = vec![0u8; 65536];
    loop {
        tokio::select! {
            r = stream.read(&mut buf), if !stream_closed => {
                match r {
                    Ok(0) => {
                        stream_closed = true;
                        let _ = channel.eof().await;
                    }
                    Ok(n) => channel.data(&buf[..n]).await.map_err(|e| e.to_string())?,
                    Err(e) => return Err(e.to_string()),
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if stream.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | None => break,
                    _ => {}
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    //! These tests stand up a real in-process SSH server (`russh::server`,
    //! not a mock) and a real TCP echo server as the tunnel target, so what's
    //! being verified is the actual protocol behavior `open_tunnel` relies
    //! on — handshake, host-key verification, password/key auth accept and
    //! reject, and `direct-tcpip` data forwarding — not just our own code in
    //! isolation.
    use super::*;
    use russh::keys::{Algorithm, PrivateKey};
    use russh::server::{self, Auth, Msg, Server as _, Session};
    use russh::{Channel, ChannelId, ChannelOpenFailure};
    use std::collections::HashMap;
    use tokio::net::tcp::OwnedWriteHalf;

    /// A bare TCP echo server standing in for "the database" being tunneled
    /// to: whatever bytes a connection sends, it gets back unchanged.
    async fn spawn_echo_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 4096];
                    loop {
                        match stream.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if stream.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        });
        port
    }

    /// Minimal test SSH server: accepts a configurable password and/or any
    /// public key, and implements `direct-tcpip` by opening a real TCP
    /// connection to whatever host:port the client asked for and bridging
    /// bytes both ways — exactly what a real `sshd` does for `ssh -L`.
    #[derive(Clone)]
    struct TestSshServer {
        password: Option<String>,
        accept_any_key: bool,
        writers: Arc<Mutex<HashMap<ChannelId, OwnedWriteHalf>>>,
    }

    impl TestSshServer {
        fn new(password: Option<&str>, accept_any_key: bool) -> Self {
            Self {
                password: password.map(str::to_string),
                accept_any_key,
                writers: Arc::new(Mutex::new(HashMap::new())),
            }
        }
    }

    impl server::Server for TestSshServer {
        type Handler = Self;
        fn new_client(&mut self, _peer_addr: Option<SocketAddr>) -> Self {
            self.clone()
        }
    }

    impl server::Handler for TestSshServer {
        type Error = russh::Error;

        async fn auth_password(&mut self, _user: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(match &self.password {
                Some(expected) if expected == password => Auth::Accept,
                _ => Auth::reject(),
            })
        }

        async fn auth_publickey(
            &mut self,
            _user: &str,
            _public_key: &russh::keys::PublicKey,
        ) -> Result<Auth, Self::Error> {
            Ok(if self.accept_any_key { Auth::Accept } else { Auth::reject() })
        }

        async fn channel_open_direct_tcpip(
            &mut self,
            channel: Channel<Msg>,
            host_to_connect: &str,
            port_to_connect: u32,
            _originator_address: &str,
            _originator_port: u32,
            reply: server::ChannelOpenHandle,
            session: &mut Session,
        ) -> Result<(), Self::Error> {
            let target = match TcpStream::connect((host_to_connect, port_to_connect as u16)).await {
                Ok(s) => s,
                Err(_) => {
                    reply.reject(ChannelOpenFailure::ConnectFailed).await;
                    return Ok(());
                }
            };
            let channel_id = channel.id();
            let (mut read_half, write_half) = target.into_split();
            self.writers.lock().await.insert(channel_id, write_half);
            reply.accept().await;

            let handle = session.handle();
            tokio::spawn(async move {
                let mut buf = [0u8; 65536];
                loop {
                    match read_half.read(&mut buf).await {
                        Ok(0) | Err(_) => {
                            let _ = handle.eof(channel_id).await;
                            break;
                        }
                        Ok(n) => {
                            if handle.data(channel_id, buf[..n].to_vec()).await.is_err() {
                                break;
                            }
                        }
                    }
                }
            });
            Ok(())
        }

        async fn data(
            &mut self,
            channel: ChannelId,
            data: &[u8],
            _session: &mut Session,
        ) -> Result<(), Self::Error> {
            if let Some(w) = self.writers.lock().await.get_mut(&channel) {
                let _ = w.write_all(data).await;
            }
            Ok(())
        }
    }

    /// Starts `handler` as a real SSH server on an ephemeral local port.
    /// Returns the port and the SHA256 fingerprint of the host key it
    /// presents (so tests can exercise TOFU pinning against a known-good
    /// value).
    async fn spawn_ssh_server(handler: TestSshServer) -> (u16, String) {
        let host_key = PrivateKey::random(&mut rand10::rng(), Algorithm::Ed25519).unwrap();
        let fingerprint = host_key
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        let config = Arc::new(server::Config {
            keys: vec![host_key],
            ..Default::default()
        });
        let socket = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = socket.local_addr().unwrap().port();
        let mut sh = handler;
        tokio::spawn(async move {
            let running = sh.run_on_socket(config, &socket);
            let _ = running.await;
        });
        (port, fingerprint)
    }

    fn base_config(port: u16) -> SshConfig {
        SshConfig {
            host: "127.0.0.1".to_string(),
            port,
            user: "tester".to_string(),
            auth_mode: "password".to_string(),
            password: Some("correct horse".to_string()),
            key_file: None,
            key_passphrase: None,
            host_key_fingerprint: None,
        }
    }

    #[tokio::test]
    async fn round_trip_through_tunnel() {
        let echo_port = spawn_echo_server().await;
        let (ssh_port, _fingerprint) =
            spawn_ssh_server(TestSshServer::new(Some("correct horse"), false)).await;

        let tunnel = open_tunnel(&base_config(ssh_port), "127.0.0.1", echo_port)
            .await
            .expect("tunnel should open");

        let mut conn = TcpStream::connect(("127.0.0.1", tunnel.local_port))
            .await
            .unwrap();
        conn.write_all(b"hello through the tunnel").await.unwrap();
        let mut buf = [0u8; 64];
        let n = conn.read(&mut buf).await.unwrap();
        assert_eq!(&buf[..n], b"hello through the tunnel");
    }

    #[tokio::test]
    async fn wrong_password_is_rejected() {
        let echo_port = spawn_echo_server().await;
        let (ssh_port, _fingerprint) =
            spawn_ssh_server(TestSshServer::new(Some("correct horse"), false)).await;

        let mut config = base_config(ssh_port);
        config.password = Some("wrong password".to_string());

        let result = open_tunnel(&config, "127.0.0.1", echo_port).await;
        assert!(result.is_err(), "wrong password should be rejected");
        assert!(result.unwrap_err().contains("rejected"));
    }

    #[tokio::test]
    async fn host_key_fingerprint_mismatch_is_rejected() {
        let echo_port = spawn_echo_server().await;
        let (ssh_port, _actual_fingerprint) =
            spawn_ssh_server(TestSshServer::new(Some("correct horse"), false)).await;

        let mut config = base_config(ssh_port);
        config.host_key_fingerprint = Some("SHA256:not-the-real-fingerprint".to_string());

        let result = open_tunnel(&config, "127.0.0.1", echo_port).await;
        let err = result.expect_err("a mismatched pinned host key should be rejected");
        assert!(err.contains("doesn't match"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn host_key_fingerprint_match_is_accepted() {
        let echo_port = spawn_echo_server().await;
        let (ssh_port, fingerprint) =
            spawn_ssh_server(TestSshServer::new(Some("correct horse"), false)).await;

        let mut config = base_config(ssh_port);
        config.host_key_fingerprint = Some(fingerprint.clone());

        let tunnel = open_tunnel(&config, "127.0.0.1", echo_port)
            .await
            .expect("a matching pinned fingerprint should be accepted");
        assert_eq!(tunnel.host_key_fingerprint, fingerprint);
    }

    #[tokio::test]
    async fn key_based_auth_succeeds() {
        let key = PrivateKey::random(&mut rand10::rng(), Algorithm::Ed25519).unwrap();
        let key_path = std::env::temp_dir().join(format!("dh-studio-ssh-test-{}.key", uuid::Uuid::new_v4()));
        std::fs::write(
            &key_path,
            key.to_openssh(russh::keys::ssh_key::LineEnding::LF).unwrap(),
        )
        .unwrap();

        let echo_port = spawn_echo_server().await;
        let (ssh_port, _fingerprint) = spawn_ssh_server(TestSshServer::new(None, true)).await;

        let mut config = base_config(ssh_port);
        config.auth_mode = "key".to_string();
        config.password = None;
        config.key_file = Some(key_path.to_string_lossy().to_string());

        let result = open_tunnel(&config, "127.0.0.1", echo_port).await;
        std::fs::remove_file(&key_path).ok();
        result.expect("key-based auth should succeed");
    }

    #[tokio::test]
    async fn concurrent_connections_are_not_cross_wired() {
        let echo_port = spawn_echo_server().await;
        let (ssh_port, _fingerprint) =
            spawn_ssh_server(TestSshServer::new(Some("correct horse"), false)).await;

        let tunnel = open_tunnel(&base_config(ssh_port), "127.0.0.1", echo_port)
            .await
            .expect("tunnel should open");

        // Two local connections sharing the one SSH session (the same way a
        // pooled driver like sqlx would), each round-tripping a distinct
        // payload — proving channels are correctly multiplexed rather than
        // one connection's bytes leaking into another's.
        let mut conns = Vec::new();
        for _ in 0..2 {
            conns.push(
                TcpStream::connect(("127.0.0.1", tunnel.local_port))
                    .await
                    .unwrap(),
            );
        }

        let payloads = ["connection-one-payload", "connection-two-payload"];
        let mut tasks = Vec::new();
        for (mut conn, payload) in conns.into_iter().zip(payloads) {
            tasks.push(tokio::spawn(async move {
                conn.write_all(payload.as_bytes()).await.unwrap();
                let mut buf = vec![0u8; payload.len()];
                conn.read_exact(&mut buf).await.unwrap();
                assert_eq!(buf, payload.as_bytes());
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
    }
}
