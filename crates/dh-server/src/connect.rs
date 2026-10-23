//! `POST /v1/connect`: check the details the browser sent, then open a pool.
//! Only Postgres, MySQL, MariaDB and MongoDB are accepted, with no file
//! paths of any kind and SSH by password only (AC-8; spec 0025 AC-26): the
//! server has no files of the user's to read, and nothing here is ever
//! written to disk or a log.

use dh_core::api::ServerDescriptor;
use dh_core::db::{DbAdapter, MongoAdapter, MongoParams, MySqlAdapter, MySqlParams, PgAdapter, PgParams};
use serde_json::Value;
use std::sync::Arc;

/// Why a connect request was refused.
#[derive(Debug)]
pub enum ConnectError {
    /// 422, naming the field.
    Refused { field: String },
    /// 422, the details did not parse.
    Invalid(String),
    /// 502, the database could not be reached. The text has no secret in it.
    Unreachable(String),
}

const SSL_FILE_FIELDS: [&str; 3] = ["ssl_ca_file", "ssl_client_cert_file", "ssl_client_key_file"];

/// What a valid request describes, before any pool is opened.
pub enum Params {
    Postgres(PgParams),
    /// `mysql` and `mariadb` alike: one adapter, which follows the server
    /// it detects.
    Mysql(MySqlParams),
    Mongodb(MongoParams),
}

/// An open pool, plus the server it detected (MySQL and MariaDB only), so
/// the page follows the detected flavor as the desktop app does.
pub struct Opened {
    pub adapter: Arc<dyn DbAdapter>,
    pub server: Option<ServerDescriptor>,
}

/// Check the request and build the adapter parameters. `force_read_only` is
/// `DH_READ_ONLY`: the request can only add a lock, never remove it.
pub fn parse(body: Value, force_read_only: bool) -> Result<(Params, Vec<String>), ConnectError> {
    let Value::Object(mut obj) = body else {
        return Err(ConnectError::Invalid("expected a JSON object".into()));
    };
    let kind = match obj.get("kind").and_then(Value::as_str) {
        Some(k @ ("postgres" | "mysql" | "mariadb" | "mongodb")) => k.to_string(),
        _ => {
            return Err(ConnectError::Refused {
                field: "kind".into(),
            })
        }
    };
    for field in SSL_FILE_FIELDS {
        if present(obj.get(field)) {
            return Err(ConnectError::Refused {
                field: field.into(),
            });
        }
        obj.remove(field);
    }
    let ssh_password = obj
        .remove("ssh_password")
        .and_then(|v| v.as_str().map(str::to_string));
    if let Some(Value::Object(ssh)) = obj.get_mut("ssh") {
        for field in ["key_file", "key_passphrase"] {
            if present(ssh.get(field)) {
                return Err(ConnectError::Refused {
                    field: format!("ssh.{field}"),
                });
            }
            ssh.remove(field);
        }
        match ssh.get("auth_mode").and_then(Value::as_str) {
            None | Some("password") => {}
            Some(_) => {
                return Err(ConnectError::Refused {
                    field: "ssh.auth_mode".into(),
                })
            }
        }
        ssh.insert("auth_mode".into(), "password".into());
        ssh.insert(
            "password".into(),
            ssh_password
                .clone()
                .map(Value::String)
                .unwrap_or(Value::Null),
        );
    } else {
        obj.remove("ssh");
    }
    let mut secrets: Vec<String> = ssh_password.into_iter().collect();
    if let Some(p) = obj.get("password").and_then(Value::as_str) {
        secrets.push(p.to_string());
    }
    secrets.retain(|s| !s.is_empty());
    obj.entry("password")
        .or_insert_with(|| Value::String(String::new()));
    obj.entry("database")
        .or_insert_with(|| Value::String(String::new()));
    let obj = Value::Object(obj);
    let params = match kind.as_str() {
        "postgres" => {
            let mut p: PgParams = from_value(obj)?;
            p.guard.read_only |= force_read_only;
            Params::Postgres(p)
        }
        "mysql" | "mariadb" => {
            let mut p: MySqlParams = from_value(obj)?;
            p.guard.read_only |= force_read_only;
            Params::Mysql(p)
        }
        _ => {
            let mut p: MongoParams = from_value(obj)?;
            p.guard.read_only |= force_read_only;
            Params::Mongodb(p)
        }
    };
    Ok((params, secrets))
}

/// Open the pool. Errors have every secret replaced before they leave.
pub async fn open(params: Params, secrets: &[String]) -> Result<Opened, ConnectError> {
    let plain = |adapter: Arc<dyn DbAdapter>| Opened { adapter, server: None };
    let opened: Result<Opened, String> = match params {
        Params::Postgres(p) => PgAdapter::connect(&p)
            .await
            .map(|a| plain(Arc::new(a)))
            .map_err(|e| e.to_string()),
        Params::Mysql(p) => MySqlAdapter::connect(&p)
            .await
            .map(|a| {
                let server = Some(a.server().descriptor());
                Opened { adapter: Arc::new(a), server }
            })
            .map_err(|e| e.to_string()),
        Params::Mongodb(p) => MongoAdapter::connect(&p)
            .await
            .map(|a| plain(Arc::new(a)))
            .map_err(|e| e.to_string()),
    };
    opened.map_err(|e| ConnectError::Unreachable(scrub(&e, secrets)))
}

fn from_value<T: serde::de::DeserializeOwned>(v: Value) -> Result<T, ConnectError> {
    serde_json::from_value(v).map_err(|e| ConnectError::Invalid(e.to_string()))
}

fn present(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// Replace every secret in `text`, so no error body carries one.
pub fn scrub(text: &str, secrets: &[String]) -> String {
    // Longest first, so a secret that contains another one is hidden whole
    // instead of leaving its tail behind (`hunter2` around `hunter`).
    let mut ordered: Vec<&String> = secrets.iter().filter(|s| !s.is_empty()).collect();
    ordered.sort_by_key(|s| std::cmp::Reverse(s.len()));
    ordered
        .into_iter()
        .fold(text.to_string(), |acc, s| acc.replace(s.as_str(), "***"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn refused(v: Value) -> String {
        match parse(v, false) {
            Err(ConnectError::Refused { field }) => field,
            Err(other) => panic!("wrong error: {other:?}"),
            Ok(_) => panic!("accepted"),
        }
    }

    fn pg() -> Value {
        json!({"kind":"postgres","host":"db","port":5432,"user":"u","password":"pw","database":"d"})
    }

    #[test]
    fn accepts_postgres_and_mongodb() {
        assert!(parse(pg(), false).is_ok());
        let m = json!({"kind":"mongodb","host":"h","user":"u","password":"pw","database":"d","srv":true});
        assert!(parse(m, false).is_ok());
    }

    fn my(kind: &str) -> Value {
        json!({"kind":kind,"host":"db","port":3306,"user":"u","password":"pw"})
    }

    #[test]
    fn accepts_mysql_and_mariadb_with_the_same_parameters() {
        for kind in ["mysql", "mariadb"] {
            let (Params::Mysql(p), secrets) = parse(my(kind), false).unwrap() else {
                panic!("{kind}")
            };
            assert_eq!((p.host.as_str(), p.port, p.database.as_deref()), ("db", 3306, None));
            assert_eq!(secrets, vec!["pw".to_string()]);
        }
        let mut v = my("mariadb");
        v["database"] = json!("shop");
        v["ssl_mode"] = json!("REQUIRED");
        let (Params::Mysql(p), _) = parse(v, false).unwrap() else {
            panic!()
        };
        assert_eq!((p.database.as_deref(), p.ssl_mode.as_deref()), (Some("shop"), Some("REQUIRED")));
    }

    #[test]
    fn mysql_refuses_file_paths_and_ssh_keys() {
        for f in SSL_FILE_FIELDS {
            let mut v = my("mysql");
            v[f] = json!("/etc/ssl/x.pem");
            assert_eq!(refused(v), f);
        }
        let mut v = my("mariadb");
        v["ssh"] = json!({"host":"jump","port":22,"user":"me","key_file":"/k"});
        assert_eq!(refused(v), "ssh.key_file");
        let mut v = my("mysql");
        v["ssh"] = json!({"host":"jump","port":22,"user":"me"});
        v["ssh_password"] = json!("sshpw");
        let (Params::Mysql(p), secrets) = parse(v, false).unwrap() else {
            panic!()
        };
        assert_eq!(p.ssh.unwrap().password.as_deref(), Some("sshpw"));
        assert!(secrets.contains(&"sshpw".to_string()));
    }

    #[test]
    fn the_server_switch_locks_mysql_too() {
        let (Params::Mysql(p), _) = parse(my("mysql"), true).unwrap() else {
            panic!()
        };
        assert!(p.guard.read_only);
    }

    #[test]
    fn refuses_sqlite() {
        assert_eq!(refused(json!({"kind":"sqlite","host":"x"})), "kind");
        assert_eq!(refused(json!({"host":"x"})), "kind");
    }

    #[test]
    fn refuses_ssl_files_but_not_empty_ones() {
        for f in SSL_FILE_FIELDS {
            let mut v = pg();
            v[f] = json!("/etc/ssl/x.pem");
            assert_eq!(refused(v), f);
        }
        let mut v = pg();
        v["ssl_ca_file"] = json!("");
        assert!(parse(v, false).is_ok());
    }

    #[test]
    fn ssh_is_password_only() {
        let ssh = |extra: Value| {
            let mut v = pg();
            let mut s = json!({"host":"jump","port":22,"user":"me"});
            s.as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            v["ssh"] = s;
            v["ssh_password"] = json!("sshpw");
            v
        };
        assert_eq!(refused(ssh(json!({"key_file":"/k"}))), "ssh.key_file");
        assert_eq!(
            refused(ssh(json!({"key_passphrase":"p"}))),
            "ssh.key_passphrase"
        );
        assert_eq!(refused(ssh(json!({"auth_mode":"key"}))), "ssh.auth_mode");
        let (Params::Postgres(p), secrets) = parse(ssh(json!({})), false).unwrap() else {
            panic!()
        };
        let cfg = p.ssh.unwrap();
        assert_eq!(
            (cfg.auth_mode.as_str(), cfg.password.as_deref()),
            ("password", Some("sshpw"))
        );
        assert!(secrets.contains(&"sshpw".to_string()) && secrets.contains(&"pw".to_string()));
    }

    #[test]
    fn the_server_switch_forces_read_only_and_the_request_cannot_lift_it() {
        let mut v = pg();
        v["read_only"] = json!(false);
        let (Params::Postgres(p), _) = parse(v, true).unwrap() else {
            panic!()
        };
        assert!(p.guard.read_only);
        let mut v = pg();
        v["read_only"] = json!(true);
        let (Params::Postgres(p), _) = parse(v, false).unwrap() else {
            panic!()
        };
        assert!(p.guard.read_only);
    }

    #[test]
    fn scrub_removes_every_secret() {
        let out = scrub(
            "auth failed for pw via sshpw",
            &["pw".into(), "sshpw".into()],
        );
        assert!(!out.contains("pw"));
    }

    #[test]
    fn scrub_hides_a_secret_that_contains_another_secret() {
        // The SSH password comes first in the list, as `parse` builds it.
        let out = scrub(
            "auth failed for hunter2",
            &["hunter".into(), "hunter2".into()],
        );
        assert!(!out.contains("hunter") && !out.contains('2'), "{out}");
    }

    #[test]
    fn scrub_hides_every_occurrence_and_leaves_other_text_alone() {
        assert_eq!(
            scrub("pw then pw again", &["pw".into()]),
            "*** then *** again"
        );
        assert_eq!(scrub("nothing here", &[]), "nothing here");
    }

    #[test]
    fn a_body_that_is_not_an_object_is_invalid() {
        for body in [json!([]), json!("postgres"), json!(null), json!(5)] {
            assert!(matches!(parse(body, false), Err(ConnectError::Invalid(_))));
        }
    }

    #[test]
    fn a_kind_that_is_not_a_string_is_refused_as_the_kind_field() {
        assert_eq!(refused(json!({"kind": 5})), "kind");
        assert_eq!(refused(json!({"kind": "POSTGRES"})), "kind");
    }

    #[test]
    fn mongodb_refuses_ssl_files_too() {
        let v = json!({"kind":"mongodb","host":"h","user":"u","ssl_client_key_file":"/k.pem"});
        assert_eq!(refused(v), "ssl_client_key_file");
    }

    #[test]
    fn an_ssh_key_file_that_is_empty_is_ignored() {
        let mut v = pg();
        v["ssh"] = json!({"host":"jump","port":22,"user":"me","key_file":"","key_passphrase":null});
        v["ssh_password"] = json!("sshpw");
        assert!(parse(v, false).is_ok());
    }

    #[test]
    fn password_as_the_ssh_auth_mode_is_accepted() {
        let mut v = pg();
        v["ssh"] = json!({"host":"jump","port":22,"user":"me","auth_mode":"password"});
        assert!(parse(v, false).is_ok());
    }

    #[test]
    fn an_ssh_password_with_no_ssh_block_is_dropped_but_still_scrubbed() {
        let mut v = pg();
        v["ssh_password"] = json!("orphan");
        let (Params::Postgres(p), secrets) = parse(v, false).unwrap() else {
            panic!()
        };
        assert!(p.ssh.is_none());
        assert!(secrets.contains(&"orphan".to_string()));
    }

    #[test]
    fn an_empty_password_is_not_a_secret_to_scrub() {
        let mut v = pg();
        v["password"] = json!("");
        let (_, secrets) = parse(v, false).unwrap();
        assert!(secrets.is_empty(), "{secrets:?}");
    }

    #[test]
    fn read_only_stays_off_when_neither_the_server_nor_the_request_asks() {
        let (Params::Postgres(p), _) = parse(pg(), false).unwrap() else {
            panic!()
        };
        assert!(!p.guard.read_only);
    }

    #[test]
    fn the_server_switch_locks_mongodb_too() {
        let m = json!({"kind":"mongodb","host":"h","user":"u","password":"pw","database":"d"});
        let (Params::Mongodb(p), _) = parse(m, true).unwrap() else {
            panic!()
        };
        assert!(p.guard.read_only);
    }
}
