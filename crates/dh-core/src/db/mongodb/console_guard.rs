use super::console_parse::parse_db_call;

/// Console methods that only read (aggregate is judged by its stages).
const READ_METHODS: &[&str] =
    &["find", "findOne", "count", "countDocuments", "estimatedDocumentCount", "distinct"];

/// Read only check for a console script (spec 0007): `Some(reason)` when the
/// script must be refused on a read only connection, without the prefix.
///
/// It reads the script the way `run_mongo_impl` does (same `use` and `show`
/// forms, same [`parse_db_call`]), so the method it judges is the method the
/// console would run. Anything not on the allowlist is refused, including
/// commands the console cannot parse (`db.runCommand(...)`,
/// `db.adminCommand(...)`), so it fails closed. A script holds one command:
/// [`validate_chain`] rejects a second one glued on before anything runs.
pub(super) fn console_refusal(script: &str) -> Option<String> {
    let s = script.trim();
    // Nothing to run: the console answers with its own "Empty command" hint.
    if s.is_empty() {
        return None;
    }
    if s.strip_prefix("use ").map(str::trim).is_some_and(|n| !n.is_empty()) {
        return None;
    }
    if matches!(s, "show dbs" | "show databases" | "show collections" | "show tables") {
        return None;
    }
    if s.starts_with("db.") {
        let Some(call) = parse_db_call(s) else {
            // The console cannot parse it: db.runCommand({...}), or a read
            // with unbalanced brackets. Name the method when it is not a read.
            let method = s[3..]
                .split(|c: char| c == '(' || c.is_whitespace())
                .next()
                .and_then(|head| head.rsplit('.').next())
                .filter(|m| !m.is_empty() && !READ_METHODS.contains(m) && *m != "aggregate");
            return Some(match method {
                Some(method) => format!("{method} is not allowed"),
                None => "this command could not be recognised as a read".into(),
            });
        };
        return match call.method.as_str() {
            m if READ_METHODS.contains(&m) => None,
            "aggregate" => pipeline_refusal(&call.args),
            other => Some(format!("{other} is not allowed")),
        };
    }
    // Bare JSON: an object is a find, an array is an aggregation pipeline.
    if s.starts_with('{') {
        return None;
    }
    if s.starts_with('[') {
        return pipeline_refusal(s);
    }
    Some("this command could not be recognised as a read".into())
}

/// An aggregation pipeline that writes: a `$out` or `$merge` stage anywhere in
/// it (a sub pipeline of `$facet` or `$lookup` included). A pipeline that
/// cannot be read is refused too, because it cannot be checked. Parsed the
/// same way the console parses it, so both see the same stages.
fn pipeline_refusal(args: &str) -> Option<String> {
    let parsed: serde_json::Value =
        match serde_json::from_str(&super::mongo_json::quote_bare_keys(args)) {
            Ok(v) => v,
            Err(_) => return Some("this pipeline could not be read to check it for $out or $merge".into()),
        };
    write_stage(&parsed).map(|stage| format!("a {stage} stage is not allowed"))
}

fn write_stage(v: &serde_json::Value) -> Option<&'static str> {
    match v {
        serde_json::Value::Object(map) => {
            if map.contains_key("$out") {
                return Some("$out");
            }
            if map.contains_key("$merge") {
                return Some("$merge");
            }
            map.values().find_map(write_stage)
        }
        serde_json::Value::Array(items) => items.iter().find_map(write_stage),
        _ => None,
    }
}

/// The read only guard on Mongo (spec 0007). Mongo has no session lock, so
/// these tests are the whole safety net: the console classifier is a pure
/// table, and the adapter tests use a client that never connects (the driver
/// connects lazily), so a write that is not refused would fail loudly on the
/// missing server instead of passing.
#[cfg(test)]
mod read_only_tests {
    use super::*;
    use crate::db::mongodb::MongoAdapter;
    use crate::db::mongodb::params::MongoParams;
    use mongodb::Client;
    use crate::db::read_only::ReadOnlyGuard;
    use crate::db::{DbError, DbResult};
    use crate::api::{ConnGuard, QueryOp, SchemaOp};
    use crate::db::READ_ONLY_PREFIX;

    fn allowed(scripts: &[&str]) {
        for s in scripts {
            assert_eq!(console_refusal(s), None, "should allow: {s}");
        }
    }

    fn refused_with(script: &str, needle: &str) {
        let why = console_refusal(script).unwrap_or_else(|| panic!("should refuse: {script}"));
        assert!(why.contains(needle), "{script}: `{why}` should mention `{needle}`");
    }

    /// AC-4: the read commands run.
    #[test]
    fn the_console_reads_are_allowed() {
        allowed(&[
            "",
            "   ",
            "use reports",
            "show dbs",
            "show databases",
            "show collections",
            "show tables",
            "db.users.find({})",
            "db.users.find({ \"a\": 1 }).limit(5).sort({ \"a\": -1 })",
            "db.users.findOne({ \"a\": 1 })",
            "db.users.count({})",
            "db.users.countDocuments({ \"a\": 1 })",
            "db.users.estimatedDocumentCount()",
            "db.users.distinct(\"a\")",
            "db.users.aggregate([{ \"$match\": { \"a\": 1 } }, { \"$group\": { \"_id\": \"$b\" } }])",
            "db.users.aggregate([ { $match: { a: 1 } } ])",
            "{ \"a\": 1 }",
            "[{ \"$match\": { \"a\": 1 } }]",
            "db.a.b.find({})",
        ]);
    }

    /// AC-4: every write method, by name.
    #[test]
    fn the_console_writes_are_refused_by_name() {
        for method in [
            "insertOne", "insertMany", "updateOne", "updateMany", "deleteOne", "deleteMany",
            "replaceOne", "findOneAndUpdate", "findOneAndDelete", "drop", "createIndex",
            "dropIndex", "renameCollection", "bulkWrite", "remove", "save",
        ] {
            refused_with(&format!("db.users.{method}({{}})"), method);
        }
    }

    /// AC-4: `runCommand`, `adminCommand` and the other `db.` helpers the
    /// console cannot parse are refused by name, not passed on.
    #[test]
    fn database_level_commands_are_refused() {
        refused_with("db.runCommand({ \"dropDatabase\": 1 })", "runCommand");
        refused_with("db.adminCommand({ \"shutdown\": 1 })", "adminCommand");
        refused_with("db.dropDatabase()", "dropDatabase");
        refused_with("db.getSiblingDB(\"x\").users.deleteMany({})", "getSiblingDB");
        refused_with("db.createCollection(\"x\")", "createCollection");
        refused_with("db.", "could not be recognised");
    }

    /// AC-4: `$out` and `$merge` write, at any depth.
    #[test]
    fn aggregate_write_stages_are_refused_at_any_depth() {
        refused_with("db.users.aggregate([{ \"$match\": {} }, { \"$out\": \"copy\" }])", "$out");
        refused_with("db.users.aggregate([{ \"$merge\": { \"into\": \"copy\" } }])", "$merge");
        refused_with("db.users.aggregate([{ $out: \"copy\" }])", "$out");
        refused_with(
            "db.users.aggregate([{ \"$facet\": { \"x\": [{ \"$out\": \"copy\" }] } }])",
            "$out",
        );
        refused_with(
            "db.users.aggregate([{ \"$lookup\": { \"from\": \"b\", \"pipeline\": [{ \"$merge\": \"c\" }], \"as\": \"x\" } }])",
            "$merge",
        );
        refused_with("[{ \"$out\": \"copy\" }]", "$out");
        refused_with("[{ \"$match\": {} }, { \"$merge\": \"copy\" }]", "$merge");
    }

    /// A pipeline that cannot be read cannot be checked, so it is refused.
    /// A name that merely contains `$out` as text is not a stage.
    #[test]
    fn an_unreadable_pipeline_is_refused_and_a_string_is_not_a_stage() {
        refused_with("db.users.aggregate([{ \"$match\": ", "could not be recognised");
        refused_with("db.users.aggregate(not json)", "could not be read");
        allowed(&["db.users.aggregate([{ \"$match\": { \"name\": \"$out\" } }])"]);
    }

    /// Fail closed: text the console would not recognise is refused too.
    #[test]
    fn unrecognised_text_is_refused() {
        refused_with("drop everything", "could not be recognised");
        refused_with("use", "could not be recognised");
        refused_with("show users", "could not be recognised");
        refused_with("SELECT * FROM users", "could not be recognised");
    }

    /// The classifier and the console read the same method: what the console
    /// dispatches on is what is judged, chain and all.
    #[test]
    fn the_judged_method_is_the_one_the_console_runs() {
        for script in [
            "db.users.find({}).limit(5)",
            "db.users.deleteMany({}).limit(5)",
            "db.a.b.find({})",
            "db.users.aggregate([]).pretty()",
        ] {
            let call = parse_db_call(script).unwrap();
            let reads = READ_METHODS.contains(&call.method.as_str()) || call.method == "aggregate";
            assert_eq!(console_refusal(script).is_none(), reads, "{script}");
        }
    }

    // ---- the adapter, on a client that never connects ---------------------

    async fn adapter(read_only: bool) -> MongoAdapter {
        let client = Client::with_uri_str("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200")
            .await
            .unwrap();
        MongoAdapter {
            client,
            database: std::sync::RwLock::new("app".into()),
            guard: ReadOnlyGuard::new(read_only),
            _ssh_tunnel: None,
        }
    }

    fn is_refusal<T>(res: DbResult<T>) -> bool {
        matches!(&res, Err(DbError::ReadOnly(m)) if m.starts_with(READ_ONLY_PREFIX))
    }

    /// AC-4, AC-5: every write the adapter offers is refused before it can
    /// reach the server (there is none to reach, so a miss would be a
    /// different error).
    #[tokio::test]
    async fn every_write_method_is_refused() {
        let a = adapter(true).await;
        let oid = "507f1f77bcf86cd799439011";
        assert!(is_refusal(a.save_document("users", oid, "{}").await));
        assert!(is_refusal(a.insert_document("users", "{}").await));
        assert!(is_refusal(a.create_collection(None, "x").await));
        assert!(is_refusal(a.duplicate_table(None, None, "users", "copy", true).await));
        assert!(is_refusal(a.create_index("app", "users", "ix", &["a".to_string()], false, None, None, None, None).await));
        assert!(is_refusal(a.drop_index("app", "users", "ix").await));

        let ops = [SchemaOp::DropColumn { table: "users".into(), name: "a".into() }];
        assert!(is_refusal(a.apply_schema_ops_batch(None, None, &ops).await));

        let insert = QueryOp::Insert { table: "users".into(), values: Default::default(), skip_empty: false };
        let delete = QueryOp::Delete { table: "users".into(), match_row: Default::default() };
        let update = QueryOp::Update { table: "users".into(), set: Default::default(), match_row: Default::default() };
        let bulk = QueryOp::BulkUpdate {
            table: "users".into(),
            column: "a".into(),
            value: None,
            filters: vec![],
            custom_where: None,
        };
        for op in [insert, delete, update, bulk, QueryOp::DropTable { table: "users".into() }] {
            assert!(is_refusal(a.execute_op(None, None, &op).await), "{op:?}");
            let streamed = a.execute_op_stream(None, None, &op, &mut |_| Ok(())).await;
            assert!(is_refusal(streamed), "{op:?}");
        }
        assert!(is_refusal(a.execute_params(None, "DELETE FROM users", &[]).await));
        assert!(is_refusal(a.run_sql(None, None, "DELETE FROM users").await));
        assert!(is_refusal(a.run_sql_params(None, "DELETE FROM users WHERE a = ?", &[Some("1".into())]).await));
        let streamed = a.run_sql_stream(None, None, "UPDATE users SET a = 1", None, &mut |_| Ok(())).await;
        assert!(is_refusal(streamed));
    }

    /// AC-4: the console is refused before it reaches the driver, for the
    /// writes and for `$out`.
    #[tokio::test]
    async fn console_writes_are_refused_by_the_adapter() {
        let a = adapter(true).await;
        for script in [
            "db.users.insertOne({ \"a\": 1 })",
            "db.users.deleteMany({})",
            "db.users.aggregate([{ \"$out\": \"copy\" }])",
            "db.runCommand({ \"dropDatabase\": 1 })",
        ] {
            assert!(is_refusal(a.run_mongo("app", None, script, None).await), "{script}");
        }
    }

    /// AC-14: reads and console navigation are not refused. `use` and `show
    /// dbs` need no collection; a find reaches the (missing) server and fails
    /// there, which proves the guard let it through.
    #[tokio::test]
    async fn reads_get_past_the_guard() {
        let a = adapter(true).await;
        let used = a.run_mongo("app", None, "use reports", None).await.unwrap();
        assert_eq!(used.switch_db.as_deref(), Some("reports"));
        let found = a.run_mongo("app", None, "db.users.find({})", None).await;
        assert!(!is_refusal(found), "a find must not be refused");
        let select = a.run_sql(None, None, "SELECT * FROM users").await;
        assert!(!is_refusal(select), "a SELECT must not be refused");
        let read_op = QueryOp::Count { table: "users".into(), filters: vec![], custom_where: None };
        assert!(!is_refusal(a.execute_op(None, None, &read_op).await));
    }

    /// AC-1: with the flag off nothing is refused, whatever the script.
    #[tokio::test]
    async fn a_connection_that_is_not_read_only_refuses_nothing() {
        let a = adapter(false).await;
        assert!(!is_refusal(a.run_mongo("app", None, "db.users.deleteMany({})", None).await));
        assert!(!is_refusal(a.insert_document("users", "{}").await));
        assert!(!is_refusal(a.create_collection(None, "x").await));
    }

    /// AC-1: params saved before this feature carry none of the four keys.
    #[test]
    fn legacy_params_default_to_not_read_only() {
        let p: MongoParams = serde_json::from_value(serde_json::json!({
            "host": "h", "user": "u", "password": "p", "database": "d",
        }))
        .unwrap();
        assert_eq!(p.guard, ConnGuard::default());
        let ro: MongoParams = serde_json::from_value(serde_json::json!({
            "host": "h", "user": "u", "password": "p", "database": "d",
            "read_only": true, "env_label": "Production",
        }))
        .unwrap();
        assert!(ro.guard.read_only);
        assert_eq!(ro.guard.env_label.as_deref(), Some("Production"));
    }
}
