//! The whole HTTP surface (spec 0010): `/v1/info`, `/v1/connect`, and every
//! data route under `/v1/c/{handle}/`. A handle is the only thing that picks
//! a database; nothing here looks up an account, a saved connection or a file.

mod browse;
mod data;
mod mongo;
#[cfg(test)]
mod tests;

use crate::config::Config;
use crate::connect::{self, ConnectError};
use crate::guard::guard;
use crate::registry::{Registry, IDLE, MAX_HANDLES};
use axum::extract::{DefaultBodyLimit, FromRequestParts, RawPathParams, State};
use axum::http::StatusCode;
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dh_core::db::{DbAdapter, READ_ONLY_PREFIX};
use rand::RngCore;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

pub type Adapter = Arc<dyn DbAdapter>;

/// An import sends every row in one request (spec 0008: at most 100 MB of
/// file), so this one route takes a larger body than axum's 2 MB default.
const IMPORT_BODY_LIMIT: usize = 256 * 1024 * 1024;

pub struct AppState {
    pub cfg: Arc<Config>,
    pub handles: Registry<Adapter>,
}

pub type Shared = Arc<AppState>;

impl AppState {
    pub fn new(cfg: Config) -> Shared {
        Self::with_limits(cfg, MAX_HANDLES, IDLE)
    }

    pub fn with_limits(cfg: Config, max: usize, idle: Duration) -> Shared {
        Arc::new(Self {
            cfg: Arc::new(cfg),
            handles: Registry::new(max, idle),
        })
    }

    /// `DH_READ_ONLY` decides this, never a request (AC-7).
    fn refuse_writes(&self) -> Result<(), Response> {
        if self.cfg.read_only {
            return Err((
                StatusCode::FORBIDDEN,
                format!("{READ_ONLY_PREFIX} this server is read only (DH_READ_ONLY)."),
            )
                .into_response());
        }
        Ok(())
    }
}

/// Close pools that were dropped from the registry, off the request path.
fn close_all(dropped: Vec<Adapter>) {
    for a in dropped {
        tokio::spawn(async move { a.close().await });
    }
}

/// Every 60 seconds, close the pools of handles that went idle (AC-9).
pub fn spawn_sweeper(state: Shared) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        loop {
            tick.tick().await;
            close_all(state.handles.sweep());
        }
    });
}

/// The pool a `/v1/c/{handle}/...` path names. It resolves before the body is
/// read, so an unknown handle answers 404 without processing anything.
pub struct Live(pub Adapter);

impl FromRequestParts<Shared> for Live {
    type Rejection = Response;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &Shared,
    ) -> Result<Self, Self::Rejection> {
        let params = RawPathParams::from_request_parts(parts, state)
            .await
            .map_err(IntoResponse::into_response)?;
        let handle = params
            .iter()
            .find(|(k, _)| *k == "handle")
            .map(|(_, v)| v.to_string())
            .unwrap_or_default();
        let (found, expired) = state.handles.get(&handle);
        close_all(expired);
        found.map(Live).ok_or_else(unknown_handle)
    }
}

fn unknown_handle() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error": "unknown_handle"})),
    )
        .into_response()
}

/// A database error as a response. A read only refusal is a 403, anything
/// else the same 400 with the text as before.
pub(crate) fn fail(e: impl ToString) -> Response {
    let text = e.to_string();
    let status = if text.starts_with(READ_ONLY_PREFIX) {
        StatusCode::FORBIDDEN
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, text).into_response()
}

/// `Ok(value)` as JSON, `Err` through [`fail`].
pub(crate) fn json_or<T: serde::Serialize>(r: Result<T, impl ToString>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err(e) => fail(e),
    }
}

pub(crate) fn empty_or(r: Result<(), impl ToString>) -> Response {
    match r {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => fail(e),
    }
}

async fn info(State(st): State<Shared>) -> Json<Value> {
    Json(json!({"key_required": st.cfg.access_key.is_some(), "read_only": st.cfg.read_only}))
}

async fn connect_route(State(st): State<Shared>, Json(body): Json<Value>) -> Response {
    let (params, secrets) = match connect::parse(body, st.cfg.read_only) {
        Ok(p) => p,
        Err(e) => return connect_error(e),
    };
    let adapter = match connect::open(params, &secrets).await {
        Ok(a) => a,
        Err(e) => return connect_error(e),
    };
    let handle = new_handle();
    close_all(st.handles.insert(handle.clone(), adapter));
    Json(json!({"handle": handle})).into_response()
}

fn connect_error(e: ConnectError) -> Response {
    match e {
        ConnectError::Refused { field } => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "unsupported_field", "field": field})),
        )
            .into_response(),
        ConnectError::Invalid(m) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"error": "invalid", "message": m})),
        )
            .into_response(),
        ConnectError::Unreachable(m) => (StatusCode::BAD_GATEWAY, m).into_response(),
    }
}

/// 128 random bits, base64url.
fn new_handle() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

async fn close_route(State(st): State<Shared>, params: RawPathParams) -> Response {
    let handle = params
        .iter()
        .find(|(k, _)| *k == "handle")
        .map(|(_, v)| v.to_string())
        .unwrap_or_default();
    match st.handles.remove(&handle) {
        Some(a) => {
            a.close().await;
            StatusCode::NO_CONTENT.into_response()
        }
        None => unknown_handle(),
    }
}

/// The API, plus the built web page from `static_dir` for every other path.
/// The guards wrap both, so a foreign Host gets a 403 for a page too.
pub fn router(state: Shared, static_dir: Option<&str>) -> Router {
    let app = Router::new()
        .route("/v1/info", get(info))
        .route("/v1/connect", post(connect_route))
        .route("/v1/c/{handle}/close", post(close_route))
        .route("/v1/c/{handle}/tables", get(browse::tables))
        .route("/v1/c/{handle}/schemas", get(browse::schemas))
        .route("/v1/c/{handle}/schema/{*table}", get(browse::schema))
        .route(
            "/v1/c/{handle}/mongo/field-tree/{*collection}",
            get(browse::field_tree),
        )
        .route("/v1/c/{handle}/databases", get(browse::databases))
        .route("/v1/c/{handle}/catalog", get(browse::catalog))
        .route("/v1/c/{handle}/schemas-in", post(browse::schemas_in))
        .route(
            "/v1/c/{handle}/schema-objects",
            post(browse::schema_objects),
        )
        .route("/v1/c/{handle}/roles", get(browse::roles))
        .route("/v1/c/{handle}/extensions", post(browse::extensions))
        .route("/v1/c/{handle}/role-details", get(browse::role_details))
        .route(
            "/v1/c/{handle}/active-schema",
            get(browse::active_schema).put(browse::set_active_schema),
        )
        .route(
            "/v1/c/{handle}/disconnect-database",
            post(browse::disconnect_database),
        )
        .route("/v1/c/{handle}/sql", post(data::sql))
        .route("/v1/c/{handle}/explain", post(data::explain))
        .route("/v1/c/{handle}/op", post(data::op))
        .route("/v1/c/{handle}/schema-ops", post(data::schema_ops))
        .route("/v1/c/{handle}/duplicate", post(data::duplicate))
        .route(
            "/v1/c/{handle}/import",
            post(data::import).layer(DefaultBodyLimit::max(IMPORT_BODY_LIMIT)),
        )
        .route(
            "/v1/c/{handle}/import/capabilities",
            post(data::import_capabilities),
        )
        .route("/v1/c/{handle}/mongo/documents", post(mongo::documents))
        .route(
            "/v1/c/{handle}/mongo/documents/ext",
            post(mongo::documents_ext),
        )
        .route(
            "/v1/c/{handle}/mongo/documents/save",
            post(mongo::save_document),
        )
        .route(
            "/v1/c/{handle}/mongo/documents/insert",
            post(mongo::insert_document),
        )
        .route("/v1/c/{handle}/mongo/run", post(mongo::run))
        .route("/v1/c/{handle}/mongo/explain", post(mongo::explain))
        .route(
            "/v1/c/{handle}/mongo/collections",
            post(mongo::create_collection),
        );
    let app = match static_dir {
        Some(dir) => {
            app.fallback_service(tower_http::services::ServeDir::new(dir).not_found_service(
                tower_http::services::ServeFile::new(
                    std::path::PathBuf::from(dir).join("index.html"),
                ),
            ))
        }
        None => app,
    };
    app.layer(middleware::from_fn_with_state(state.cfg.clone(), guard))
        .with_state(state)
}
