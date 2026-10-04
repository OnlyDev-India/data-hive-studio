use std::collections::{BTreeMap, HashMap, HashSet};
use crate::api::{GraphColumn, GraphLink, GraphTable, SchemaGraph};
use crate::db::{DbError, DbResult};
use super::PgAdapter;

// Plain and partitioned tables; a partition folds into its parent.
const TABLES_SQL: &str = "SELECT c.relname::text FROM pg_class c \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 AND c.relkind IN ('r','p') AND NOT c.relispartition \
     ORDER BY c.relname";

const COLUMNS_SQL: &str = "SELECT c.relname::text, a.attname::text, \
            format_type(a.atttypid, a.atttypmod), a.attnotnull \
     FROM pg_attribute a \
     JOIN pg_class c ON c.oid = a.attrelid \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     WHERE n.nspname = $1 AND c.relkind IN ('r','p') AND NOT c.relispartition \
       AND a.attnum > 0 AND NOT a.attisdropped \
     ORDER BY c.relname, a.attnum";

// Full unique indexes over plain columns, primary keys included.
const UNIQUES_SQL: &str = "SELECT c.relname::text, ic.relname::text, i.indisprimary, a.attname::text \
     FROM pg_index i \
     JOIN pg_class c ON c.oid = i.indrelid \
     JOIN pg_class ic ON ic.oid = i.indexrelid \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) \
     WHERE n.nspname = $1 AND i.indisunique AND i.indpred IS NULL AND 0 <> ALL(i.indkey) \
       AND c.relkind IN ('r','p') AND NOT c.relispartition";

// One row per constraint touching the schema from either side, its key
// columns unnested in order. Constraints cloned onto partitions are left
// out, and a partition on either side is named by its root table.
const FKS_SQL: &str = "SELECT con.conname::text, \
            sn.nspname::text, sc.relname::text, tn.nspname::text, tc.relname::text, \
            array_agg(sa.attname::text ORDER BY k.ord), \
            array_agg(ta.attname::text ORDER BY k.ord), \
            con.confdeltype::text \
     FROM pg_constraint con \
     JOIN pg_class sc ON sc.oid = COALESCE(pg_partition_root(con.conrelid), con.conrelid) \
     JOIN pg_namespace sn ON sn.oid = sc.relnamespace \
     JOIN pg_class tc ON tc.oid = COALESCE(pg_partition_root(con.confrelid), con.confrelid) \
     JOIN pg_namespace tn ON tn.oid = tc.relnamespace \
     CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(s, t, ord) \
     JOIN pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = k.s \
     JOIN pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = k.t \
     WHERE con.contype = 'f' AND con.conparentid = 0 \
       AND (sn.nspname = $1 OR tn.nspname = $1) \
     GROUP BY con.oid, con.conname, sn.nspname, sc.relname, tn.nspname, tc.relname, con.confdeltype \
     ORDER BY sc.relname, con.conname";

type ColumnRow = (String, String, String, bool);
/// table, index, is primary key, column
type UniqueRow = (String, String, bool, String);
type FkRow = (String, String, String, String, String, Vec<String>, Vec<String>, String);

impl PgAdapter {
    /// One schema's tables and foreign keys in four concurrent catalog
    /// queries, however many tables it holds.
    pub(super) async fn schema_graph(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> DbResult<(SchemaGraph, Vec<String>)> {
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let tables = sqlx::query_scalar::<_, String>(TABLES_SQL).bind(&schema).fetch_all(&pool);
        let cols = sqlx::query_as::<_, ColumnRow>(COLUMNS_SQL).bind(&schema).fetch_all(&pool);
        let uniques = sqlx::query_as::<_, UniqueRow>(UNIQUES_SQL).bind(&schema).fetch_all(&pool);
        let fks = sqlx::query_as::<_, FkRow>(FKS_SQL).bind(&schema).fetch_all(&pool);
        let (tables, cols, uniques, fks) =
            tokio::try_join!(tables, cols, uniques, fks).map_err(DbError::SqlEngine)?;
        let bound = [Some(schema.clone())];
        let statements = [TABLES_SQL, COLUMNS_SQL, UNIQUES_SQL, FKS_SQL]
            .iter()
            .map(|sql| super::inline_placeholders(sql, &bound, true) + ";")
            .collect();
        Ok((build_graph(&schema, tables, cols, uniques, fks), statements))
    }
}

fn on_delete(code: &str) -> Option<String> {
    Some(
        match code {
            "c" => "CASCADE",
            "n" => "SET NULL",
            "d" => "SET DEFAULT",
            "r" => "RESTRICT",
            _ => "NO ACTION",
        }
        .to_string(),
    )
}

fn build_graph(
    schema: &str,
    table_names: Vec<String>,
    cols: Vec<ColumnRow>,
    uniques: Vec<UniqueRow>,
    fks: Vec<FkRow>,
) -> SchemaGraph {
    let mut pk: HashSet<(String, String)> = HashSet::new();
    let mut indexes: HashMap<(String, String), HashSet<String>> = HashMap::new();
    for (table, index, primary, column) in uniques {
        if primary {
            pk.insert((table.clone(), column.clone()));
        }
        indexes.entry((table, index)).or_default().insert(column);
    }
    let mut keys: HashMap<String, Vec<HashSet<String>>> = HashMap::new();
    for ((table, _), set) in indexes {
        keys.entry(table).or_default().push(set);
    }
    let mut columns: HashMap<String, Vec<GraphColumn>> = HashMap::new();
    for (table, name, data_type, not_null) in cols {
        let primary_key = pk.contains(&(table.clone(), name.clone()));
        columns.entry(table).or_default().push(GraphColumn { name, data_type, primary_key, not_null });
    }
    let known: HashSet<&str> = table_names.iter().map(String::as_str).collect();
    let mut stubs: BTreeMap<(String, String), GraphTable> = BTreeMap::new();
    let mut links = Vec::new();
    let mut seen = HashSet::new();
    for (name, from_schema, from_table, to_schema, to_table, from_columns, to_columns, del) in fks {
        let ends = [(&from_schema, &from_table), (&to_schema, &to_table)];
        // A local end must be a table the diagram draws.
        if ends.iter().any(|(s, t)| s.as_str() == schema && !known.contains(t.as_str())) {
            continue;
        }
        if !seen.insert((from_schema.clone(), from_table.clone(), name.clone())) {
            continue;
        }
        for (s, t) in ends {
            if s != schema {
                stubs.entry((s.clone(), t.clone())).or_insert_with(|| GraphTable {
                    schema: Some(s.clone()),
                    name: t.clone(),
                    stub: true,
                    columns: Vec::new(),
                    error: None,
                });
            }
        }
        // Keys are only read for this schema, so a link from a stub stays false.
        let from_set: HashSet<String> = from_columns.iter().cloned().collect();
        let unique = from_schema == schema
            && keys.get(&from_table).is_some_and(|sets| sets.contains(&from_set));
        links.push(GraphLink {
            id: name,
            from_schema: Some(from_schema),
            from_table,
            from_columns,
            to_schema: Some(to_schema),
            to_table,
            to_columns,
            inferred: false,
            on_delete: on_delete(&del),
            unique,
            array: false,
        });
    }
    let mut tables: Vec<GraphTable> = table_names
        .into_iter()
        .map(|name| GraphTable {
            schema: Some(schema.to_string()),
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

    #[test]
    fn cross_schema_ends_become_one_stub_each() {
        let fks = vec![
            ("o_acc".into(), "public".into(), "orders".into(), "billing".into(), "accounts".into(),
             vec!["account_id".into()], vec!["id".into()], "c".into()),
            ("i_acc".into(), "public".into(), "invoices".into(), "billing".into(), "accounts".into(),
             vec!["account_id".into()], vec!["id".into()], "a".into()),
        ];
        let g = build_graph(
            "public",
            vec!["invoices".into(), "orders".into()],
            vec![],
            vec![],
            fks,
        );
        assert_eq!(g.tables.len(), 3);
        let stub = &g.tables[2];
        assert!(stub.stub);
        assert_eq!((stub.schema.as_deref(), stub.name.as_str()), (Some("billing"), "accounts"));
        assert_eq!(g.links[0].on_delete.as_deref(), Some("CASCADE"));
    }

    #[test]
    fn links_to_tables_the_diagram_leaves_out_are_dropped() {
        let fks = vec![(
            "v".into(), "public".into(), "a".into(), "public".into(), "gone".into(),
            vec!["x".into()], vec!["y".into()], "a".into(),
        )];
        let g = build_graph("public", vec!["a".into()], vec![], vec![], fks);
        assert!(g.links.is_empty());
    }

    #[test]
    fn unique_needs_the_whole_key_on_the_referencing_side() {
        let fk = |name: &str, from: &str, cols: &[&str]| -> FkRow {
            (name.into(), "public".into(), from.into(), "public".into(), "users".into(),
             cols.iter().map(|c| c.to_string()).collect(), vec!["id".into(); cols.len()], "a".into())
        };
        let uniques = vec![
            ("a".into(), "a_pkey".into(), true, "x".into()),
            ("a".into(), "a_pkey".into(), true, "y".into()),
            ("b".into(), "b_key".into(), false, "z".into()),
        ];
        let fks = vec![fk("ax", "a", &["x"]), fk("ayx", "a", &["y", "x"]), fk("bz", "b", &["z"])];
        let g = build_graph(
            "public",
            vec!["a".into(), "b".into(), "users".into()],
            vec![("b".into(), "z".into(), "int".into(), false)],
            uniques,
            fks,
        );
        let unique: Vec<_> = g.links.iter().map(|l| (l.id.as_str(), l.unique)).collect();
        assert_eq!(unique, [("ax", false), ("ayx", true), ("bz", true)]);
        assert!(!g.tables[1].columns[0].primary_key, "a unique column is not a primary key");
    }
}
