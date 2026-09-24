//! `POST /v1/connect`: check the details the browser sent, then open a pool.
//! Only Postgres and MongoDB are accepted, with no file paths of any kind
//! and SSH by password only (AC-8): the server has no files of the user's to
//! read, and nothing here is ever written to disk or a log.

use dh_core::db::{DbAdapter, MongoAdapter, MongoParams, PgAdapter, PgParams};
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
    Mongodb(MongoParams),
}

/// Check the request and build the adapter parameters. `force_read_only` is
/// `DH_READ_ONLY`: the request can only add a lock, never remove it.
pub fn parse(body: Value, force_read_only: bool) -> Result<(Params, Vec<String>), ConnectError> {
    let Value::Object(mut obj) = body else {
        return Err(ConnectError::Invalid("expected a JSON object".into()));
    };
    let kind = match obj.get("kind").and_then(Value::as_str) {
        Some(k @ ("postgres" | "mongodb")) => k.to_string(),
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
    let params = if kind == "postgres" {
        let mut p: PgParams = from_value(obj)?;
        p.guard.read_only |= force_read_only;
        Params::Postgres(p)
    } else {
        let mut p: MongoParams = from_value(obj)?;
        p.guard.read_only |= force_read_only;
        Params::Mongodb(p)
    };
    Ok((params, secrets))
}

/// Open the pool. Errors have every secret replaced before they leave.
pub async fn open(params: Params, secrets: &[String]) -> Result<Arc<dyn DbAdapter>, ConnectError> {
    let adapter: Result<Arc<dyn DbAdapter>, String> = match params {
        Params::Postgres(p) => PgAdapter::connect(&p)
            .await
            .map(|a| Arc::new(a) as _)
            .map_err(|e| e.to_string()),
        Params::Mongodb(p) => MongoAdapter::connect(&p)
            .await
            .map(|a| Arc::new(a) as _)
            .map_err(|e| e.to_string()),
    };
    adapter.map_err(|e| ConnectError::Unreachable(scrub(&e, secrets)))
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
    secrets
        .iter()
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
}
