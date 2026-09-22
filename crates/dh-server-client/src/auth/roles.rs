//! Server role shapes and the pure permission check (spec 0010). The
//! `impl Store` methods that list accounts and change roles live in
//! `dh-server`'s own `auth::roles`.

use super::{AccessError, AuthCtx, ServerRole};

/// An account as the People section shows it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Account {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub server_role: ServerRole,
    pub can_manage_roles: bool,
    /// Providers this person has signed in with, such as `google`, `github`.
    pub providers: Vec<String>,
    pub created_ms: i64,
}

/// Whether `actor` may move an account from `current` to `new`. Pure, so the
/// whole permission table tests without Postgres.
pub fn check_role_change(actor: &AuthCtx, current: ServerRole, new: ServerRole) -> Result<(), AccessError> {
    if actor.is_owner() {
        return Ok(());
    }
    let touches_owner = current == ServerRole::Owner || new == ServerRole::Owner;
    if actor.can_manage_accounts() && !touches_owner {
        return Ok(());
    }
    Err(AccessError::Forbidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(role: ServerRole, switch: bool) -> AuthCtx {
        AuthCtx {
            user_id: "actor".into(),
            session_id: String::new(),
            email: "actor@x.com".into(),
            name: "A".into(),
            server_role: role,
            can_manage_roles: switch,
        }
    }

    #[test]
    fn role_change_permission_table() {
        use ServerRole::*;
        let owner = ctx(Owner, false);
        for (from, to) in [(Member, Admin), (Admin, Owner), (Owner, Member), (Member, Owner)] {
            assert!(check_role_change(&owner, from, to).is_ok(), "owner may {from:?}->{to:?}");
        }
        let helper = ctx(Admin, true);
        assert!(check_role_change(&helper, Member, Admin).is_ok());
        assert!(check_role_change(&helper, Admin, Member).is_ok());
        assert_eq!(check_role_change(&helper, Member, Owner), Err(AccessError::Forbidden), "cannot make an owner");
        assert_eq!(check_role_change(&helper, Owner, Member), Err(AccessError::Forbidden), "cannot touch an owner");
        assert_eq!(check_role_change(&ctx(Admin, false), Member, Admin), Err(AccessError::Forbidden));
        assert_eq!(check_role_change(&ctx(Member, false), Member, Admin), Err(AccessError::Forbidden));
    }
}
