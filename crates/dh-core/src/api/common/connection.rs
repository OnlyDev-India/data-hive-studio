use serde::{Deserialize, Serialize};

/// The kind of database a connection is talking to. Extend this enum to add
/// support for more databases.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Sqlite,
    #[allow(dead_code)]
    Postgres,
    #[allow(dead_code)]
    Mysql,
    #[allow(dead_code)]
    Mongodb,
    /// Amazon DocumentDB — speaks the MongoDB wire protocol, so it's
    /// connected to identically to `Mongodb` (see `server::vault`'s
    /// `conn_secret_params`, which maps both to the same
    /// `AdapterParams::Mongodb`). Kept as a distinct variant purely so a
    /// saved connection remembers which picker entry it was created from.
    #[allow(dead_code)]
    DocumentDb,
}

impl DbKind {
    pub fn pretty(self) -> &'static str {
        match self {
            DbKind::Sqlite => "SQLite",
            DbKind::Postgres => "PostgreSQL",
            DbKind::Mysql => "MySQL",
            DbKind::Mongodb => "MongoDB",
            DbKind::DocumentDb => "Amazon DocumentDB",
        }
    }
}

impl Default for DbKind {
    /// Every shared team-server connection predates the `kind` column and
    /// was Postgres — this is the correct default for backfilling those rows
    /// and for JSON payloads that omit the field.
    fn default() -> Self {
        DbKind::Postgres
    }
}

/// How careful to be with a connection (spec 0007). Travels as one unit
/// through every place a connection is saved, described or opened, flattened
/// into the owning struct so the wire shape stays four plain fields.
/// Adapters read only `read_only`; the other three pass through to
/// [`ConnectionInfo`] for the UI to display.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConnGuard {
    /// Writes are refused, not just warned about. Fixed for the life of an
    /// adapter: changing it means a new connection.
    #[serde(default)]
    pub read_only: bool,
    /// Environment name shown as a chip (Production, Staging, or custom).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_label: Option<String>,
    /// Palette key for a custom label's colour (presets ignore it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_color: Option<String>,
    /// Ask before every write, even without a Production label.
    #[serde(default)]
    pub confirm_writes: bool,
}

/// The palette keys a custom environment label may use. Keep in step with
/// `ENV_COLORS` in `src/shared/api/env.ts` and the `--env-*` variables in
/// `src/index.css`.
pub const ENV_COLOR_KEYS: [&str; 8] = [
    "red", "orange", "amber", "green", "teal", "blue", "purple", "grey",
];

/// Longest environment label, in characters.
pub const ENV_LABEL_MAX_CHARS: usize = 24;

impl ConnGuard {
    /// Check the label and colour before a connection is saved and return the
    /// tidy copy to store: the label is trimmed and an empty one becomes
    /// none, and an empty colour becomes none. A label longer than
    /// [`ENV_LABEL_MAX_CHARS`] or a colour outside [`ENV_COLOR_KEYS`] is an
    /// error, so a bad value never reaches the saved file (spec 0007).
    pub fn normalized(mut self) -> Result<Self, String> {
        self.env_label = match self.env_label.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(label) if label.chars().count() > ENV_LABEL_MAX_CHARS => {
                return Err(format!(
                    "Environment label must be {ENV_LABEL_MAX_CHARS} characters or fewer."
                ));
            }
            Some(label) => Some(label.to_string()),
        };
        self.env_color = match self.env_color.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(key) if ENV_COLOR_KEYS.contains(&key) => Some(key.to_string()),
            Some(key) => {
                return Err(format!(
                    "Unknown environment colour \"{key}\". Pick one of: {}.",
                    ENV_COLOR_KEYS.join(", ")
                ));
            }
        };
        Ok(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    /// Real file path this connection was opened from (or saved to). `None`
    /// for databases that only exist in-memory/temp (e.g. freshly created).
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(flatten)]
    pub guard: ConnGuard,
}

#[cfg(test)]
mod conn_guard_tests {
    use super::*;

    /// AC-1: a connection saved before spec 0007 has none of the four keys
    /// and loads as not read only, no label.
    #[test]
    fn legacy_connection_info_loads_with_a_default_guard() {
        let info: ConnectionInfo =
            serde_json::from_str(r#"{"id":"a","name":"db","kind":"postgres"}"#).unwrap();
        assert_eq!(info.guard, ConnGuard::default());
        assert!(!info.guard.read_only);
        assert_eq!(info.guard.env_label, None);
        assert!(!info.guard.confirm_writes);
    }

    fn guard_with(label: Option<&str>, color: Option<&str>) -> ConnGuard {
        ConnGuard {
            env_label: label.map(str::to_string),
            env_color: color.map(str::to_string),
            ..ConnGuard::default()
        }
    }

    #[test]
    fn normalized_trims_the_label_and_drops_empty_values() {
        let g = guard_with(Some("  Staging EU  "), Some("")).normalized().unwrap();
        assert_eq!(g.env_label.as_deref(), Some("Staging EU"));
        assert_eq!(g.env_color, None);
        let g = guard_with(Some("   "), None).normalized().unwrap();
        assert_eq!(g.env_label, None);
    }

    #[test]
    fn normalized_accepts_exactly_24_characters_and_refuses_25() {
        let ok = "a".repeat(ENV_LABEL_MAX_CHARS);
        assert!(guard_with(Some(&ok), None).normalized().is_ok());
        let too_long = "a".repeat(ENV_LABEL_MAX_CHARS + 1);
        assert!(guard_with(Some(&too_long), None).normalized().is_err());
        // Characters, not bytes: 24 multi byte characters still fit.
        let wide = "é".repeat(ENV_LABEL_MAX_CHARS);
        assert!(guard_with(Some(&wide), None).normalized().is_ok());
    }

    #[test]
    fn normalized_refuses_a_colour_outside_the_palette() {
        for key in ENV_COLOR_KEYS {
            assert!(guard_with(Some("x"), Some(key)).normalized().is_ok(), "{key}");
        }
        let err = guard_with(Some("x"), Some("hotpink")).normalized().unwrap_err();
        assert!(err.contains("hotpink"), "{err}");
    }

    #[test]
    fn normalized_leaves_the_flags_alone() {
        let g = ConnGuard { read_only: true, confirm_writes: true, ..ConnGuard::default() };
        assert_eq!(g.clone().normalized().unwrap(), g);
    }

    /// The guard is flattened, so the wire shape is four plain fields next
    /// to `id`/`name`/`kind`, and unset label fields are left out.
    #[test]
    fn guard_fields_sit_flat_on_the_wire() {
        let info = ConnectionInfo {
            id: "a".into(),
            name: "db".into(),
            kind: DbKind::Postgres,
            source_path: None,
            guard: ConnGuard {
                read_only: true,
                env_label: Some("Production".into()),
                env_color: None,
                confirm_writes: true,
            },
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["read_only"], true);
        assert_eq!(v["env_label"], "Production");
        assert_eq!(v["confirm_writes"], true);
        assert!(v.get("env_color").is_none());
        assert!(v.get("guard").is_none());

        let back: ConnectionInfo = serde_json::from_value(v).unwrap();
        assert_eq!(back, info);
    }
}
