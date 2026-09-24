use super::{json_or, Live, Shared};
use crate::bodies::{DuplicateBody, ExecuteOpBody, SchemaOpsBody, SqlBody};
use axum::extract::State;
use axum::response::Response;
use axum::Json;
use dh_core::api::QueryOp;
use dh_core::db::{sql_class, Dialect, StmtClass};

/// True for the operations that only read.
fn op_reads(op: &QueryOp) -> bool {
    matches!(
        op,
        QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. }
    )
}

pub(super) async fn sql(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<SqlBody>,
) -> Response {
    // A script is refused as a whole before any statement runs.
    if sql_class(Dialect::Postgres, &b.sql) != StmtClass::Read {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    json_or(
        a.run_sql(b.database.as_deref(), b.schema.as_deref(), &b.sql)
            .await,
    )
}

pub(super) async fn op(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<ExecuteOpBody>,
) -> Response {
    if !op_reads(&b.op) {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    json_or(
        a.execute_op(b.database.as_deref(), b.schema.as_deref(), &b.op)
            .await
            .map(|o| o.result),
    )
}

pub(super) async fn schema_ops(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<SchemaOpsBody>,
) -> Response {
    if let Err(r) = st.refuse_writes() {
        return r;
    }
    json_or(
        a.apply_schema_ops_batch(b.database.as_deref(), b.schema.as_deref(), &b.ops)
            .await,
    )
}

pub(super) async fn duplicate(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<DuplicateBody>,
) -> Response {
    if let Err(r) = st.refuse_writes() {
        return r;
    }
    json_or(
        a.duplicate_table(
            b.database.as_deref(),
            b.schema.as_deref(),
            &b.source,
            &b.target,
            b.copy_data,
        )
        .await,
    )
}
