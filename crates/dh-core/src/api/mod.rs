//! Wire types shared with the frontend (mirrored by `src/shared/api/types.ts`).
//!
//! [`common`] holds engine-agnostic types plus the handful of fields/variants
//! that are Postgres-only by nature (e.g. `ColumnInfo::enum_values`,
//! `SchemaOp::SetPrimaryKey`) but live on otherwise-shared structs/enums —
//! splitting those out would mean breaking up `ColumnInfo`/`SchemaOp` into a
//! tagged wrapper type, a real API change rather than a mechanical split, so
//! they stay put (already doc-commented as engine-specific). [`mongo`] holds
//! the standalone Mongo-only result types, which had no such entanglement.

mod common;
mod mongo;

pub use common::*;
pub use mongo::*;
