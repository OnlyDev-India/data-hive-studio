use std::collections::{HashMap, HashSet};
use crate::api::{GraphColumn, GraphLink, GraphTable, SchemaGraph};
use crate::db::{DbError, DbResult};
use super::SqliteAdapter;

const COLUMNS_SQL: &str = "SELECT m.name, p.name, p.type, p.\"notnull\", p.pk \
     FROM sqlite_master m JOIN pragma_table_info(m.name) p \
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
     ORDER BY m.name, p.cid";

const FKS_SQL: &str = "SELECT m.name, f.id, f.\"table\", f.\"from\", f.\"to\" \
     FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f \
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
     ORDER BY m.name, f.id, f.seq";

// Full unique indexes; an expression column comes back with a null name.
const UNIQUES_SQL: &str = "SELECT m.name, il.name, ii.name \
     FROM sqlite_master m JOIN pragma_index_list(m.name) il JOIN pragma_index_info(il.name) ii \
     WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' \
       AND il.\"unique\" = 1 AND il.partial = 0 \
     ORDER BY m.name, il.name, ii.seqno";

/// table, column, declared type, not null, position in the primary key (0 = none)
type ColumnRow = (String, String, String, i64, i64);
/// table, fk id, referenced table, column, referenced column (null = its primary key)
type FkRow = (String, i64, String, String, Option<String>);
/// table, index, column (null = an expression)
type UniqueRow = (String, String, Option<String>);

impl SqliteAdapter {
    /// Every table with its columns, foreign keys and unique indexes in three
    /// catalog queries, however many tables the file holds.
    pub async fn schema_graph(&self) -> DbResult<(SchemaGraph, Vec<String>)> {
        let cols = sqlx::query_as::<_, ColumnRow>(COLUMNS_SQL).fetch_all(&self.pool);
        let fks = sqlx::query_as::<_, FkRow>(FKS_SQL).fetch_all(&self.pool);
        let uniques = sqlx::query_as::<_, UniqueRow>(UNIQUES_SQL).fetch_all(&self.pool);
        let (cols, fks, uniques) = tokio::try_join!(cols, fks, uniques).map_err(DbError::SqlEngine)?;
        let statements = [COLUMNS_SQL, FKS_SQL, UNIQUES_SQL].iter().map(|s| format!("{s};")).collect();
        Ok((build_graph(cols, fks, uniques), statements))
    }
}

/// Each table's unique column sets (lowercased, since SQLite matches names
/// without regard to case), dropping any index over an expression.
fn unique_sets(uniques: Vec<UniqueRow>) -> HashMap<String, Vec<HashSet<String>>> {
    let mut indexes: HashMap<(String, String), Option<HashSet<String>>> = HashMap::new();
    for (table, index, column) in uniques {
        let set = indexes.entry((table.to_lowercase(), index)).or_insert_with(|| Some(HashSet::new()));
        match (set.as_mut(), column) {
            (Some(s), Some(c)) => {
                s.insert(c.to_lowercase());
            }
            _ => *set = None,
        }
    }
    let mut out: HashMap<String, Vec<HashSet<String>>> = HashMap::new();
    for ((table, _), set) in indexes {
        if let Some(set) = set {
            out.entry(table).or_default().push(set);
        }
    }
    out
}

fn build_graph(cols: Vec<ColumnRow>, fks: Vec<FkRow>, uniques: Vec<UniqueRow>) -> SchemaGraph {
    let mut keys = unique_sets(uniques);
    let mut tables: Vec<GraphTable> = Vec::new();
    let mut pk_order: HashMap<String, Vec<(i64, String)>> = HashMap::new();
    for (table, name, data_type, not_null, pk) in cols {
        if tables.last().map(|t| t.name != table).unwrap_or(true) {
            tables.push(GraphTable { schema: None, name: table.clone(), stub: false, columns: Vec::new(), error: None });
        }
        if pk > 0 {
            pk_order.entry(table.to_lowercase()).or_default().push((pk, name.clone()));
        }
        tables.last_mut().unwrap().columns.push(GraphColumn {
            name,
            data_type,
            primary_key: pk > 0,
            not_null: not_null != 0,
        });
    }
    for (table, pk) in pk_order.iter_mut() {
        pk.sort();
        keys.entry(table.clone()).or_default().push(pk.iter().map(|(_, c)| c.to_lowercase()).collect());
    }
    // SQLite resolves table names without regard to case.
    let by_lower: HashMap<String, &str> =
        tables.iter().map(|t| (t.name.to_lowercase(), t.name.as_str())).collect();

    let mut links = Vec::new();
    let mut rows = fks.into_iter().peekable();
    while let Some((table, id, target, from, to)) = rows.next() {
        let mut from_columns = vec![from];
        let mut to_columns = vec![to];
        while let Some(next) = rows.peek() {
            if next.0 != table || next.1 != id {
                break;
            }
            let (_, _, _, from, to) = rows.next().unwrap();
            from_columns.push(from);
            to_columns.push(to);
        }
        let Some(to_table) = by_lower.get(&target.to_lowercase()) else {
            continue;
        };
        let to_columns: Vec<String> = if to_columns.iter().all(Option::is_some) {
            to_columns.into_iter().flatten().collect()
        } else {
            pk_order
                .get(&target.to_lowercase())
                .map(|keys| keys.iter().map(|(_, c)| c.clone()).collect())
                .unwrap_or_default()
        };
        if to_columns.len() != from_columns.len() {
            continue;
        }
        let from_set: HashSet<String> = from_columns.iter().map(|c| c.to_lowercase()).collect();
        let unique = keys.get(&table.to_lowercase()).is_some_and(|sets| sets.contains(&from_set));
        links.push(GraphLink {
            id: format!("{table}#{id}"),
            from_schema: None,
            from_table: table,
            from_columns,
            to_schema: None,
            to_table: to_table.to_string(),
            to_columns,
            inferred: false,
            on_delete: None,
            unique,
            array: false,
        });
    }
    SchemaGraph { tables, links }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn adapter_with(ddl: &str) -> SqliteAdapter {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("graph-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();
        sqlx::raw_sql(ddl).execute(&adapter.pool).await.unwrap();
        adapter
    }

    #[tokio::test]
    async fn reads_tables_columns_and_links_in_three_statements() {
        let adapter = adapter_with(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
             CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), body TEXT);
             CREATE VIEW v AS SELECT * FROM posts;",
        )
        .await;
        let (graph, statements) = adapter.schema_graph().await.unwrap();
        assert_eq!(statements.len(), 3);
        let names: Vec<_> = graph.tables.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["posts", "users"]);
        let users = &graph.tables[1];
        assert!(users.columns[0].primary_key);
        assert!(users.columns[1].not_null);
        assert_eq!(graph.links.len(), 1);
        let link = &graph.links[0];
        assert_eq!((link.from_table.as_str(), link.to_table.as_str()), ("posts", "users"));
        assert_eq!(link.from_columns, ["user_id"]);
        assert_eq!(link.to_columns, ["id"]);
    }

    #[tokio::test]
    async fn composite_key_is_one_link_in_key_order() {
        let adapter = adapter_with(
            "CREATE TABLE p (a INTEGER, b INTEGER, PRIMARY KEY (b, a));
             CREATE TABLE c (x INTEGER, y INTEGER, FOREIGN KEY (y, x) REFERENCES p (b, a));",
        )
        .await;
        let (graph, _) = adapter.schema_graph().await.unwrap();
        assert_eq!(graph.links.len(), 1);
        assert_eq!(graph.links[0].from_columns, ["y", "x"]);
        assert_eq!(graph.links[0].to_columns, ["b", "a"]);
    }

    #[tokio::test]
    async fn unnamed_target_resolves_to_its_primary_key() {
        let adapter = adapter_with(
            "CREATE TABLE p (a INTEGER, b INTEGER, PRIMARY KEY (b, a));
             CREATE TABLE c (x INTEGER, y INTEGER, FOREIGN KEY (x, y) REFERENCES P);",
        )
        .await;
        let (graph, _) = adapter.schema_graph().await.unwrap();
        assert_eq!(graph.links[0].to_table, "p");
        assert_eq!(graph.links[0].to_columns, ["b", "a"]);
    }

    #[tokio::test]
    async fn self_and_parallel_links_stay_separate() {
        let adapter = adapter_with(
            "CREATE TABLE emp (id INTEGER PRIMARY KEY, boss INTEGER REFERENCES emp(id));
             CREATE TABLE msg (id INTEGER PRIMARY KEY,
                               sender INTEGER REFERENCES emp(id),
                               receiver INTEGER REFERENCES emp(id));",
        )
        .await;
        let (graph, _) = adapter.schema_graph().await.unwrap();
        assert_eq!(graph.links.len(), 3);
        assert!(graph.links.iter().any(|l| l.from_table == "emp" && l.to_table == "emp"));
        let ids: std::collections::HashSet<_> = graph.links.iter().map(|l| l.id.clone()).collect();
        assert_eq!(ids.len(), 3);
    }

    #[tokio::test]
    async fn unique_flag_follows_full_unique_keys() {
        let adapter = adapter_with(
            "CREATE TABLE users (id INTEGER PRIMARY KEY);
             CREATE TABLE profiles (id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id));
             CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES users(id));
             CREATE INDEX posts_author ON posts (author_id);
             CREATE TABLE drafts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), live INTEGER);
             CREATE UNIQUE INDEX drafts_live ON drafts (user_id) WHERE live = 1;
             CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));
             CREATE UNIQUE INDEX notes_expr ON notes (user_id, abs(id));
             CREATE TABLE user_settings (user_id INTEGER PRIMARY KEY REFERENCES users(id));
             CREATE TABLE pair (a INTEGER, b INTEGER, UNIQUE (b, a));
             CREATE TABLE pair_ref (x INTEGER, y INTEGER, FOREIGN KEY (x, y) REFERENCES pair (a, b), UNIQUE (X, Y));",
        )
        .await;
        let (graph, _) = adapter.schema_graph().await.unwrap();
        let unique = |table: &str| graph.links.iter().find(|l| l.from_table == table).unwrap().unique;
        assert!(unique("profiles"));
        assert!(!unique("posts"));
        assert!(!unique("drafts"));
        assert!(!unique("notes"));
        assert!(unique("user_settings"));
        assert!(unique("pair_ref"));
        assert!(graph.links.iter().all(|l| !l.array));
    }

    #[tokio::test]
    async fn link_to_a_missing_table_is_dropped() {
        let adapter = adapter_with(
            "PRAGMA foreign_keys = OFF;
             CREATE TABLE c (x INTEGER REFERENCES gone(id));",
        )
        .await;
        let (graph, _) = adapter.schema_graph().await.unwrap();
        assert!(graph.links.is_empty());
    }
}
