//! Users & Privileges (spec 0025 AC-5): server accounts from `mysql.user`
//! and their grants from `SHOW GRANTS FOR`. View only. A user who may not
//! read `mysql.user` gets an empty list, never an error, so the sidebar
//! hides the node without a toast.

use sqlx::mysql::MySqlDatabaseError;
use crate::db::{DbError, DbResult, RoleDetail, SchemaObject};
use super::MySqlAdapter;
use super::catalog::col;
use super::connect::Flavor;
use super::rows::{fetch_text, fetch_text_conn};
use super::sql_text::sql_string;

/// Server errors that mean "you may not read this": table access denied
/// (1142), database access denied (1044), and missing a global privilege
/// (1227).
const DENIED: [u16; 3] = [1142, 1044, 1227];

fn denied(e: &DbError) -> bool {
    matches!(e, DbError::SqlEngine(err) if err
        .as_database_error()
        .and_then(|d| d.try_downcast_ref::<MySqlDatabaseError>())
        .is_some_and(|d| DENIED.contains(&d.number())))
}

/// MariaDB keeps its roles in `mysql.user` too, flagged `is_role`; they
/// aren't accounts, so they stay out of the list. Its `mysql.user` view has
/// no `account_locked` column: the flag lives in `mysql.global_priv`'s JSON.
/// `JSON_EXTRACT`, not `JSON_VALUE`: MariaDB's `JSON_VALUE` turns a JSON
/// `true` into `1`, so it never equals `'true'`.
fn accounts_sql(flavor: Flavor) -> &'static str {
    match flavor {
        Flavor::Mysql => {
            "SELECT User, Host, plugin, account_locked, max_user_connections, Super_priv \
             FROM mysql.user ORDER BY User, Host"
        }
        Flavor::Mariadb => {
            "SELECT u.User, u.Host, u.plugin, \
                    IF(JSON_EXTRACT(g.Priv, '$.account_locked') = 'true', 'Y', 'N'), \
                    u.max_user_connections, u.Super_priv \
             FROM mysql.user u JOIN mysql.global_priv g ON g.User = u.User AND g.Host = u.Host \
             WHERE u.is_role <> 'Y' ORDER BY u.User, u.Host"
        }
    }
}

/// One `mysql.user` row: `user@host` plus what the sidebar and the tab show.
struct Account {
    user: String,
    host: String,
    plugin: String,
    locked: bool,
    max_connections: i32,
    superuser: bool,
}

impl Account {
    fn from_row(r: &[Option<String>]) -> Self {
        Self {
            user: col(r, 0),
            host: col(r, 1),
            plugin: col(r, 2),
            locked: col(r, 3) == "Y",
            max_connections: col(r, 4).parse().unwrap_or(0),
            superuser: col(r, 5) == "Y",
        }
    }

    fn name(&self) -> String {
        format!("{}@{}", self.user, self.host)
    }

    /// The sidebar row's one line summary, like a Postgres role's.
    fn summary(&self) -> Option<String> {
        let bits: Vec<&str> = [self.superuser.then_some("superuser"), self.locked.then_some("locked")]
            .into_iter()
            .flatten()
            .collect();
        (!bits.is_empty()).then(|| bits.join(", "))
    }
}

impl MySqlAdapter {
    async fn accounts(&self) -> DbResult<Option<Vec<Account>>> {
        match fetch_text(&self.pool, accounts_sql(self.server.flavor), &[]).await {
            Ok(rows) => Ok(Some(rows.iter().map(|r| Account::from_row(r)).collect())),
            Err(e) if denied(&e) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub(super) async fn list_roles(&self) -> DbResult<Vec<SchemaObject>> {
        let accounts = self.accounts().await?.unwrap_or_default();
        Ok(accounts.iter().map(|a| SchemaObject { name: a.name(), extra: a.summary() }).collect())
    }

    pub(super) async fn list_role_details(&self) -> DbResult<Vec<RoleDetail>> {
        let Some(accounts) = self.accounts().await? else {
            return Ok(Vec::new());
        };
        // One connection for every `SHOW GRANTS`, so a large account list
        // never takes over the pool.
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let mut out = Vec::with_capacity(accounts.len());
        for a in accounts {
            let sql = format!("SHOW GRANTS FOR {}@{}", sql_string(&a.user), sql_string(&a.host));
            // An account whose grants can't be read still shows, with none.
            let grants = match fetch_text_conn(&mut conn, &sql, &[]).await {
                Ok(rows) => rows.iter().map(|r| col(r, 0)).collect(),
                Err(e) if denied(&e) => Vec::new(),
                Err(e) => return Err(e),
            };
            let attributes = [
                a.superuser.then(|| "Superuser".to_string()),
                (!a.locked).then(|| "Login".to_string()),
                a.locked.then(|| "Locked".to_string()),
                (!a.plugin.is_empty()).then(|| a.plugin.clone()),
            ]
            .into_iter()
            .flatten()
            .collect();
            out.push(RoleDetail {
                name: a.name(),
                attributes,
                can_login: !a.locked,
                superuser: a.superuser,
                // `0` means no per account limit.
                conn_limit: if a.max_connections > 0 { a.max_connections } else { -1 },
                valid_until: None,
                comment: None,
                member_of: Vec::new(),
                grants,
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mariadb_leaves_its_roles_out_of_the_account_list() {
        assert!(accounts_sql(Flavor::Mariadb).contains("is_role"));
        assert!(!accounts_sql(Flavor::Mysql).contains("is_role"));
    }

    #[test]
    fn an_account_row_names_itself_user_at_host() {
        let row = ["app", "%", "caching_sha2_password", "Y", "0", "N"].map(|v| Some(v.to_string()));
        let a = Account::from_row(&row);
        assert_eq!(a.name(), "app@%");
        assert_eq!(a.summary().as_deref(), Some("locked"));
        assert_eq!(a.max_connections, 0);
    }
}
