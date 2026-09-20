use crate::api::{DbKind, QueryChunk, QueryResult};

/// Sink receiving streamed row batches during SELECT-shaped operations.
pub type BatchSink<'a> = &'a mut (dyn FnMut(QueryChunk) -> DbResult<()> + Send);

/// An error produced by the database layer.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("no open connection for id '{0}'")]
    NotFound(String),
    #[error("unsupported database kind: {0:?}")]
    Unsupported(DbKind),
    #[error("{0}")]
    InvalidOperation(String),
    /// Shared by every `sqlx`-backed adapter (SQLite, Postgres) — not
    /// SQLite-specific despite the underlying crate name.
    #[error("{0}")]
    SqlEngine(#[from] sqlx::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    /// The user pressed Stop and the engine confirmed (or the run was
    /// abandoned). Never produced for an engine error nobody asked for, so a
    /// `statement_timeout` still reads as the error it is. Converted to a
    /// `cancelled` result at the `db::` wrapper boundary, so callers of those
    /// wrappers only ever see it as a result, not an `Err`.
    #[error("Stopped by user")]
    Cancelled,
    /// A write was refused because the connection is read only (spec 0007).
    /// The text always starts with [`read_only::READ_ONLY_PREFIX`] so the
    /// frontend can tell a refusal from any other failure.
    #[error("{0}")]
    ReadOnly(String),
}

pub type DbResult<T> = std::result::Result<T, DbError>;

/// A statement an adapter built from a [`QueryOp`]: dialect SQL plus its
/// bound `?` parameters.
pub struct BuiltQuery {
    pub sql: String,
    pub params: Vec<Option<String>>,
}

/// An executed structured operation plus the exact SQL that ran. The SQL
/// rides along with the result (NOT in shared adapter state) so concurrent
/// operations can never capture each other's statements for the activity log.
pub struct OpOutcome {
    pub result: QueryResult,
    pub sql: Option<String>,
}

/// Sidebar bootstrap data for one Postgres connection, fetched in a single
/// catalog round trip.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CatalogOverview {
    pub schemas: Vec<String>,
    pub databases: Vec<String>,
    pub active_schema: String,
}

/// A category of schema-scoped object the sidebar's catalog tree can list —
/// one fixed set of rows under every Postgres schema node. MongoDB only ever
/// uses `Table` (its collections); the rest don't apply there.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchemaObjectKind {
    Table,
    View,
    MaterializedView,
    Procedure,
    Function,
    Sequence,
    Type,
}

/// One row in a `list_schema_objects`/`list_roles` result — just a name plus
/// an optional secondary bit of context the sidebar shows alongside it (a
/// function's signature, a sequence's last value, a role's superuser flag).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SchemaObject {
    pub name: String,
    pub extra: Option<String>,
}

/// Full attribute set for one role (Postgres) — the Users & Privileges tab's
/// detail panel. `list_roles` above stays a short name+one-line-summary pair
/// for the sidebar tree; this is the structured version for a real UI.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RoleDetail {
    pub name: String,
    pub attributes: Vec<String>,
    pub can_login: bool,
    pub superuser: bool,
    pub conn_limit: i32,
    pub valid_until: Option<String>,
    pub comment: Option<String>,
    pub member_of: Vec<String>,
}
