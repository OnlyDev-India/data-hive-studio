use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    pub primary_key: bool,
    pub default: Option<String>,
    /// Postgres native enums: allowed labels (empty otherwise).
    #[serde(default)]
    pub enum_values: Vec<String>,
    /// Postgres only: true when the column is an array type (e.g. `text[]`,
    /// `permission[]`). The frontend can then offer array-aware editing; when
    /// the array's element type is a native enum, `enum_values` holds its
    /// labels and `data_type` is the element type followed by `[]`.
    #[serde(default)]
    pub is_array: bool,
}

/// A key's distinct-count truncation marker on a wide `FieldShape` object
/// (spec 0001, AC-5): `shown` of `total` distinct keys were kept.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldKeyTruncation {
    pub shown: u32,
    pub total: u32,
}

/// One node of a MongoDB collection's inferred nested field shape (spec
/// 0001), read only and independent of `ColumnInfo`/`TableSchema` (which
/// stay flat for the data grid's column headers, see `MongoAdapter::field_tree`
/// for the sampling that builds this).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldShape {
    /// Last path segment, e.g. `"zip"` for `address.zip`.
    pub name: String,
    /// Full dot path from the document root, e.g. `"address.zip"`.
    pub path: String,
    /// The single most common BSON type observed at this path ("object",
    /// "array", or a scalar name). Never a union — a mixed-type field still
    /// reports only its most common type, matching `inferred_schema`'s
    /// existing top-level behavior.
    #[serde(rename = "type")]
    pub bson_type: String,
    /// True when present in fewer sampled documents than its parent is
    /// (`present_count(path) < present_count(parent_path)`, where
    /// `present_count(root)` is the sample size) — NOT the raw sample size,
    /// so a field always present whenever its parent exists is not
    /// misleadingly optional just because the parent itself sometimes is not.
    pub optional: bool,
    /// Nested fields, present when `bson_type` is "object", or "array" whose
    /// sampled elements include objects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FieldShape>,
    /// Present only when `bson_type` is "array": the union of BSON types
    /// observed among sampled elements (e.g. `["object", "string"]`). The
    /// one place a union appears; `bson_type` itself never is one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub element_types: Vec<String>,
    /// Set when an object's distinct sampled keys exceeded the 50 key cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<FieldKeyTruncation>,
    /// True when `bson_type` is "object"/"array" but zero keys/elements were
    /// observed across the whole sample.
    #[serde(default)]
    pub empty: bool,
    /// True when recursion stopped at the 6 level depth cap, or the global
    /// node budget, even though the real document nests deeper.
    #[serde(default)]
    pub depth_truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    /// Constraint name (Postgres). SQLite FKs are unnamed — dropping them
    /// requires a table rebuild, so the UI treats them as system-managed.
    #[serde(default)]
    pub name: Option<String>,
    /// Referential actions as stored (Postgres). Null on SQLite.
    #[serde(default)]
    pub on_delete: Option<String>,
    #[serde(default)]
    pub on_update: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub columns: Vec<String>,
    /// Why the index exists: 'c' = explicit CREATE INDEX (editable), 'u' =
    /// UNIQUE table constraint, 'pk' = PRIMARY KEY constraint. Constraint-
    /// backed indexes cannot be dropped or altered directly in SQLite —
    /// the UI must treat them as read-only.
    pub origin: String,
    /// MongoDB only: per-column sort direction (1 = ascending, -1 =
    /// descending), parallel to `columns`. `None`/absent means all-ascending
    /// (or not applicable — SQL adapters don't report this).
    #[serde(default)]
    pub column_dirs: Option<Vec<i8>>,
    /// MongoDB only: a sparse index skips documents missing the indexed
    /// field(s).
    #[serde(default)]
    pub sparse: Option<bool>,
    /// MongoDB only: TTL index — documents expire this many seconds after
    /// the indexed (date) field's value.
    #[serde(default)]
    pub ttl_seconds: Option<u64>,
    /// MongoDB only: partial index filter, as MQL extended JSON text — only
    /// documents matching it are indexed.
    #[serde(default)]
    pub partial_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TableSchema {
    /// What this object is: "table", "view", "matview" (Postgres). Empty on
    /// older payloads — callers treat that as "table".
    #[serde(default)]
    pub kind: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub indexes: Vec<IndexInfo>,
    pub triggers: Vec<TriggerInfo>,
}

/// One trigger defined on a table. SQLite has no ALTER TRIGGER — a trigger's
/// identity is its SQL text, so it is surfaced read-only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TriggerInfo {
    pub name: String,
    /// BEFORE / AFTER / INSTEAD OF (parsed from the SQL, may be empty).
    pub timing: String,
    /// INSERT / UPDATE / DELETE (parsed from the SQL, may be empty).
    pub event: String,
    /// Full original CREATE TRIGGER statement.
    pub sql: String,
}
