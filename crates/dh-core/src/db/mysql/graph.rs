//! The relation diagram on MySQL and MariaDB (spec 0025 AC-22): one
//! database's tables and foreign keys in four concurrent
//! `information_schema` reads, however many tables it holds. Tables of the
//! drawn database carry no schema (MySQL has no schema level); a foreign key
//! into another database draws that table as a stub named by its database.

use std::collections::{BTreeMap, HashMap, HashSet};
use crate::api::{GraphColumn, GraphLink, GraphTable, SchemaGraph};
use crate::db::DbResult;
use super::MySqlAdapter;
use super::catalog::col;
use super::rows::fetch_text;

const TABLES_SQL: &str = "SELECT TABLE_NAME FROM information_schema.TABLES \
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME";

const COLUMNS_SQL: &str = "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE \
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? \
     ORDER BY TABLE_NAME, ORDINAL_POSITION";

// Unique indexes over whole columns, the primary key included. A prefix
// index (`SUB_PART`) or a functional key part (no `COLUMN_NAME`) can't
// stand for the column, so it doesn't make a link unique.
const UNIQUES_SQL: &str = "SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, \
            MAX(SUB_PART IS NOT NULL OR COLUMN_NAME IS NULL) OVER (PARTITION BY TABLE_NAME, INDEX_NAME) \
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND NON_UNIQUE = 0";

// One row per key column of each foreign key touching the database from
// either side, in key order.
const FKS_SQL: &str = "SELECT k.CONSTRAINT_NAME, k.TABLE_SCHEMA, k.TABLE_NAME, \
            k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, \
            k.COLUMN_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE \
     FROM information_schema.KEY_COLUMN_USAGE k \
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r \
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME \
      AND r.TABLE_NAME = k.TABLE_NAME \
     WHERE k.REFERENCED_TABLE_NAME IS NOT NULL \
       AND (k.TABLE_SCHEMA = ? OR k.REFERENCED_TABLE_SCHEMA = ?) \
     ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION";

type Rows = Vec<Vec<Option<String>>>;

impl MySqlAdapter {
    pub(super) async fn schema_graph(&self, database: Option<&str>) -> DbResult<(SchemaGraph, Vec<String>)> {
        let db = self.require_target(database)?;
        let (by_db, twice) = ([db], [db, db]);
        let tables = fetch_text(&self.pool, TABLES_SQL, &by_db);
        let cols = fetch_text(&self.pool, COLUMNS_SQL, &by_db);
        let uniques = fetch_text(&self.pool, UNIQUES_SQL, &by_db);
        let fks = fetch_text(&self.pool, FKS_SQL, &twice);
        let (tables, cols, uniques, fks) = tokio::try_join!(tables, cols, uniques, fks)?;
        let one = [Some(db.to_string())];
        let two = [Some(db.to_string()), Some(db.to_string())];
        let statements = [(TABLES_SQL, &one[..]), (COLUMNS_SQL, &one), (UNIQUES_SQL, &one), (FKS_SQL, &two)]
            .iter()
            .map(|(sql, bound)| crate::db::inline_placeholders(sql, bound, false) + ";")
            .collect();
        let names = tables.iter().map(|r| col(r, 0)).collect();
        Ok((build_graph(db, names, &cols, &uniques, &fks), statements))
    }
}

/// The schema a graph end carries: none in the drawn database, else the
/// other database's name.
fn end_schema(db: &str, of: &str) -> Option<String> {
    (of != db).then(|| of.to_string())
}

fn build_graph(db: &str, table_names: Vec<String>, cols: &Rows, uniques: &Rows, fks: &Rows) -> SchemaGraph {
    // Key column sets per table, and which columns are in the primary key.
    let mut pk: HashSet<(String, String)> = HashSet::new();
    let mut indexes: BTreeMap<(String, String), HashSet<String>> = BTreeMap::new();
    let mut partial: HashSet<(String, String)> = HashSet::new();
    for r in uniques {
        let (table, index, column) = (col(r, 0), col(r, 1), col(r, 2));
        if col(r, 3) == "1" {
            partial.insert((table, index));
            continue;
        }
        if index == "PRIMARY" {
            pk.insert((table.clone(), column.clone()));
        }
        indexes.entry((table, index)).or_default().insert(column);
    }
    let mut keys: HashMap<String, Vec<HashSet<String>>> = HashMap::new();
    for (key, set) in indexes {
        if !partial.contains(&key) {
            keys.entry(key.0).or_default().push(set);
        }
    }

    let mut columns: HashMap<String, Vec<GraphColumn>> = HashMap::new();
    for r in cols {
        let (table, name) = (col(r, 0), col(r, 1));
        let primary_key = pk.contains(&(table.clone(), name.clone()));
        let not_null = col(r, 3).eq_ignore_ascii_case("NO");
        columns.entry(table).or_default().push(GraphColumn { name, data_type: col(r, 2), primary_key, not_null });
    }

    // Fold key column rows into one link per constraint, in query order.
    let mut order: Vec<(String, String, String)> = Vec::new();
    let mut grouped: HashMap<(String, String, String), (String, String, Vec<String>, Vec<String>, String)> =
        HashMap::new();
    for r in fks {
        let id = (col(r, 1), col(r, 2), col(r, 0));
        let entry = grouped.entry(id.clone()).or_insert_with(|| {
            order.push(id);
            (col(r, 3), col(r, 4), Vec::new(), Vec::new(), col(r, 7))
        });
        entry.2.push(col(r, 5));
        entry.3.push(col(r, 6));
    }

    let known: HashSet<&str> = table_names.iter().map(String::as_str).collect();
    let mut stubs: BTreeMap<(String, String), GraphTable> = BTreeMap::new();
    let mut links = Vec::new();
    for id in order {
        let (from_db, from_table, name) = id.clone();
        let (to_db, to_table, from_columns, to_columns, rule) = grouped.remove(&id).unwrap_or_default();
        let ends = [(&from_db, &from_table), (&to_db, &to_table)];
        // A local end must be a table the diagram draws.
        if ends.iter().any(|(d, t)| d.as_str() == db && !known.contains(t.as_str())) {
            continue;
        }
        for (d, t) in ends {
            if d != db {
                stubs.entry((d.clone(), t.clone())).or_insert_with(|| GraphTable {
                    schema: Some(d.clone()),
                    name: t.clone(),
                    stub: true,
                    columns: Vec::new(),
                    error: None,
                });
            }
        }
        // Keys are only read for this database, so a link from a stub stays
        // false. MySQL names compare case insensitively on most servers, but
        // the catalog spells a key column the same way in both places.
        let from_set: HashSet<String> = from_columns.iter().cloned().collect();
        let unique = from_db == db && keys.get(&from_table).is_some_and(|sets| sets.contains(&from_set));
        links.push(GraphLink {
            id: name,
            from_schema: end_schema(db, &from_db),
            from_table,
            from_columns,
            to_schema: end_schema(db, &to_db),
            to_table,
            to_columns,
            inferred: false,
            on_delete: Some(rule).filter(|r| !r.is_empty()),
            unique,
            array: false,
        });
    }

    let mut tables: Vec<GraphTable> = table_names
        .into_iter()
        .map(|name| GraphTable {
            schema: None,
            columns: columns.remove(&name).unwrap_or_default(),
            name,
            stub: false,
            error: None,
        })
        .collect();
    tables.extend(stubs.into_values());
    SchemaGraph { tables, links }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(rs: &[&[&str]]) -> Rows {
        rs.iter().map(|r| r.iter().map(|v| Some(v.to_string())).collect()).collect()
    }

    #[test]
    fn multi_column_keys_fold_into_one_link_and_other_databases_become_stubs() {
        // In the query's order: by database, table, then constraint.
        let fks = rows(&[
            &["fk_in", "crm", "people", "shop", "orders", "order_id", "id", "SET NULL"],
            &["fk_line", "shop", "lines", "shop", "orders", "order_id", "id", "CASCADE"],
            &["fk_line", "shop", "lines", "shop", "orders", "region", "region", "CASCADE"],
            &["fk_acc", "shop", "orders", "billing", "accounts", "account_id", "id", "RESTRICT"],
        ]);
        let g = build_graph("shop", vec!["lines".into(), "orders".into()], &rows(&[]), &rows(&[]), &fks);
        assert_eq!(g.links.len(), 3);
        let line = &g.links[1];
        assert_eq!(line.id, "fk_line");
        assert_eq!(line.from_columns, ["order_id", "region"]);
        assert_eq!(line.to_columns, ["id", "region"]);
        assert_eq!((line.from_schema.as_deref(), line.to_schema.as_deref()), (None, None));
        assert_eq!(line.on_delete.as_deref(), Some("CASCADE"));
        // crm.people -> shop.orders: the far end is a stub named by its database.
        assert_eq!(g.links[0].from_schema.as_deref(), Some("crm"));
        let stubs: Vec<_> = g.tables.iter().filter(|t| t.stub).map(|t| (t.schema.clone(), t.name.clone())).collect();
        assert_eq!(
            stubs,
            [(Some("billing".into()), "accounts".into()), (Some("crm".into()), "people".into())]
        );
        assert!(g.tables.iter().filter(|t| !t.stub).all(|t| t.schema.is_none()));
    }

    #[test]
    fn links_to_tables_the_diagram_leaves_out_are_dropped() {
        let fks = rows(&[&["v", "shop", "a", "shop", "gone", "x", "y", "NO ACTION"]]);
        let g = build_graph("shop", vec!["a".into()], &rows(&[]), &rows(&[]), &fks);
        assert!(g.links.is_empty());
    }

    #[test]
    fn unique_needs_a_whole_column_key_on_the_referencing_side() {
        let uniques = rows(&[
            &["a", "PRIMARY", "x", "0"],
            &["a", "PRIMARY", "y", "0"],
            &["b", "b_z", "z", "0"],
            &["c", "c_w", "w", "1"],
        ]);
        let fk = |name: &str, from: &str, c: &[&str]| -> Vec<Vec<Option<String>>> {
            c.iter()
                .map(|col| {
                    [name, "shop", from, "shop", "users", col, "id", "RESTRICT"]
                        .iter()
                        .map(|v| Some(v.to_string()))
                        .collect()
                })
                .collect()
        };
        let mut fks = fk("ax", "a", &["x"]);
        fks.extend(fk("ayx", "a", &["y", "x"]));
        fks.extend(fk("bz", "b", &["z"]));
        fks.extend(fk("cw", "c", &["w"]));
        let cols = rows(&[&["a", "x", "int", "NO"], &["b", "z", "int unsigned", "YES"]]);
        let g = build_graph("shop", vec!["a".into(), "b".into(), "c".into(), "users".into()], &cols, &uniques, &fks);
        let unique: Vec<_> = g.links.iter().map(|l| (l.id.as_str(), l.unique)).collect();
        assert_eq!(unique, [("ax", false), ("ayx", true), ("bz", true), ("cw", false)]);
        assert!(g.tables[0].columns[0].primary_key && g.tables[0].columns[0].not_null);
        let z = &g.tables[1].columns[0];
        assert!(!z.primary_key && !z.not_null);
        assert_eq!(z.data_type, "int unsigned");
    }
}
