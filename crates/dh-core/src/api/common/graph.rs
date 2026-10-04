use serde::{Deserialize, Serialize};

/// One schema's tables and foreign key links, for the ER diagram. Links
/// that cross into another schema end at a stub table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SchemaGraph {
    pub tables: Vec<GraphTable>,
    pub links: Vec<GraphLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphTable {
    /// Null on SQLite and Mongo.
    pub schema: Option<String>,
    pub name: String,
    /// A table in another schema, drawn without columns.
    #[serde(default)]
    pub stub: bool,
    /// In ordinal order.
    pub columns: Vec<GraphColumn>,
    /// Mongo: the collection failed to sample.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphColumn {
    pub name: String,
    pub data_type: String,
    pub primary_key: bool,
    pub not_null: bool,
}

/// One foreign key, however many columns it spans. `from_columns` and
/// `to_columns` pair up by position.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GraphLink {
    pub id: String,
    pub from_schema: Option<String>,
    pub from_table: String,
    pub from_columns: Vec<String>,
    pub to_schema: Option<String>,
    pub to_table: String,
    pub to_columns: Vec<String>,
    /// Mongo links are guessed from field names and values.
    #[serde(default)]
    pub inferred: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_delete: Option<String>,
    /// `from_columns` are exactly the referencing table's primary key or one
    /// of its unique indexes, so the link is one to one. Always false on Mongo.
    #[serde(default)]
    pub unique: bool,
    /// Mongo: most sampled values of the field are arrays. Always false on SQL.
    #[serde(default)]
    pub array: bool,
}

/// A `schema_graph` answer plus the catalog statements it ran, for the
/// activity log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SchemaGraphResult {
    pub graph: SchemaGraph,
    pub statements: Vec<String>,
}

/// The streamed Mongo diagram: `start`, one `collection` per sampled
/// collection with its outgoing inferred links, then `done` or `error`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MongoGraphEvent {
    Start { total: usize, collections: Vec<String> },
    Collection { table: GraphTable, links: Vec<GraphLink> },
    Done,
    Error { message: String },
}
