//! `schema_graph` against a real server. `#[ignore]`d like the other live
//! Postgres tests: `cargo test -p dh-core -- --ignored pg_graph`.

use crate::db::postgres::params::PgParams;
use super::PgAdapter;

fn params() -> PgParams {
    let url = std::env::var("DH_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
    let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
    let (auth, tail) = rest.split_once('@').expect("user@host in the url");
    let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
    let (hostport, database) = tail.split_once('/').expect("/database in the url");
    let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
    serde_json::from_value(serde_json::json!({
        "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
        "password": password, "database": database, "ssl_mode": "disable",
        "pool_max": 4,
    }))
    .unwrap()
}

/// Two fresh schemas, `<tag>` and `<tag>_b`, dropped again by the caller.
async fn schemas(a: &PgAdapter) -> String {
    let tag = format!("g{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    let ddl = format!(
        "CREATE SCHEMA {t}; CREATE SCHEMA {t}_b;
         CREATE TABLE {t}_b.accounts (id int PRIMARY KEY);
         CREATE TABLE {t}.users (id int PRIMARY KEY, boss int REFERENCES {t}.users(id),
                                 account int REFERENCES {t}_b.accounts(id) ON DELETE CASCADE);
         CREATE TABLE {t}.pairs (a int, b int, PRIMARY KEY (a, b));
         CREATE TABLE {t}.msgs (id int PRIMARY KEY,
                                sender int REFERENCES {t}.users(id),
                                receiver int REFERENCES {t}.users(id),
                                pa int, pb int, FOREIGN KEY (pb, pa) REFERENCES {t}.pairs (b, a));
         CREATE TABLE {t}.events (id int, at date NOT NULL, owner int REFERENCES {t}.users(id))
           PARTITION BY RANGE (at);
         CREATE TABLE {t}.events_2026 PARTITION OF {t}.events
           FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
         CREATE VIEW {t}.v AS SELECT * FROM {t}.users;
         CREATE TABLE {t}_b.audits (id int, user_id int REFERENCES {t}.users(id));",
        t = tag
    );
    sqlx::raw_sql(&ddl).execute(&a.pool).await.unwrap();
    tag
}

async fn drop(a: &PgAdapter, tag: &str) {
    let sql = format!("DROP SCHEMA {tag} CASCADE; DROP SCHEMA {tag}_b CASCADE;");
    sqlx::raw_sql(&sql).execute(&a.pool).await.unwrap();
}

#[tokio::test]
#[ignore = "requires a live Postgres test database"]
async fn pg_graph_reads_a_schema_in_four_statements() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let tag = schemas(&a).await;
    let (g, statements) = a.schema_graph(None, Some(&tag)).await.unwrap();
    drop(&a, &tag).await;

    assert_eq!(statements.len(), 4);
    let real: Vec<_> = g.tables.iter().filter(|t| !t.stub).map(|t| t.name.as_str()).collect();
    assert_eq!(real, ["events", "msgs", "pairs", "users"], "partition folded, view left out");

    let users = g.tables.iter().find(|t| t.name == "users").unwrap();
    assert!(users.columns[0].primary_key);
    assert_eq!(users.columns[0].data_type, "integer");

    let stubs: Vec<_> = g.tables.iter().filter(|t| t.stub).map(|t| t.name.as_str()).collect();
    assert_eq!(stubs, ["accounts", "audits"], "both directions across schemas");

    let composite: Vec<_> = g.links.iter().filter(|l| l.to_table == "pairs").collect();
    assert_eq!(composite.len(), 1);
    assert_eq!(composite[0].from_columns, ["pb", "pa"]);
    assert_eq!(composite[0].to_columns, ["b", "a"]);

    assert!(g.links.iter().any(|l| l.from_table == "users" && l.to_table == "users"));
    let parallel = g.links.iter().filter(|l| l.from_table == "msgs" && l.to_table == "users").count();
    assert_eq!(parallel, 2);
    let from_events = g.links.iter().filter(|l| l.from_table == "events").count();
    assert_eq!(from_events, 1, "the partition's cloned key is not a second link");
    let cross = g.links.iter().find(|l| l.to_table == "accounts").unwrap();
    assert_eq!(cross.on_delete.as_deref(), Some("CASCADE"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database"]
async fn pg_graph_of_an_empty_schema_is_empty() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let tag = format!("e{}", &uuid::Uuid::new_v4().simple().to_string()[..10]);
    sqlx::raw_sql(&format!("CREATE SCHEMA {tag}")).execute(&a.pool).await.unwrap();
    let (g, _) = a.schema_graph(None, Some(&tag)).await.unwrap();
    sqlx::raw_sql(&format!("DROP SCHEMA {tag}")).execute(&a.pool).await.unwrap();
    assert!(g.tables.is_empty() && g.links.is_empty());
}
