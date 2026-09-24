//! The server's whole configuration, read once from the environment.

use std::net::SocketAddr;

pub const DEFAULT_BIND: &str = "127.0.0.1:8080";

/// Variables the old team server read. They are ignored now (AC-14).
const RETIRED_VARS: [&str; 6] = [
    "DH_DATABASE_URL",
    "DH_MASTER_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
];

#[derive(Debug, Clone, Default)]
pub struct Config {
    pub bind: String,
    pub static_dir: Option<String>,
    /// Only used to allow its host in the Host check.
    pub public_url: Option<String>,
    pub read_only: bool,
    pub access_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self::from_lookup(|k| std::env::var(k).ok())
    }

    /// Same as [`Config::from_env`] with the lookup passed in, for tests.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Self {
        let get = |k: &str| get(k).filter(|v| !v.is_empty());
        let bind = match (get("DH_BIND"), get("PORT")) {
            (Some(bind), _) => bind,
            // Hosting platforms inject PORT and expect every interface.
            (None, Some(port)) => format!("0.0.0.0:{port}"),
            (None, None) => DEFAULT_BIND.to_string(),
        };
        Self {
            bind,
            static_dir: get("DH_STATIC_DIR"),
            public_url: get("DH_PUBLIC_URL"),
            read_only: get("DH_READ_ONLY")
                .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")),
            access_key: get("DH_ACCESS_KEY"),
        }
    }

    /// True when `bind` is a loopback address only this machine can reach.
    pub fn binds_loopback(&self) -> bool {
        self.bind
            .parse::<SocketAddr>()
            .map(|a| a.ip().is_loopback())
            .unwrap_or(false)
    }

    /// The host part of `DH_PUBLIC_URL`, lower case, without a port.
    pub fn public_host(&self) -> Option<String> {
        let url = self.public_url.as_deref()?;
        let rest = url.split("://").nth(1).unwrap_or(url);
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        let authority = authority.rsplit('@').next().unwrap_or("");
        let host = host_of(authority);
        (!host.is_empty()).then_some(host)
    }

    /// The startup warnings the operator should see (AC-14).
    pub fn warnings(&self, is_set: impl Fn(&str) -> bool) -> Vec<String> {
        let mut out = Vec::new();
        if !self.binds_loopback() && self.access_key.is_none() {
            out.push(format!(
                "warning: listening on {} with no DH_ACCESS_KEY, so anyone who can reach this address can \
                 make the server connect to any database it can reach. Set DH_ACCESS_KEY, or keep the \
                 default {DEFAULT_BIND} and put a reverse proxy with its own sign in in front.",
                self.bind
            ));
        }
        let ignored: Vec<&str> = RETIRED_VARS.iter().copied().filter(|v| is_set(v)).collect();
        if !ignored.is_empty() {
            out.push(format!(
                "note: this server no longer uses accounts or a database, so these variables are ignored: {}",
                ignored.join(", ")
            ));
        }
        out
    }
}

/// Lower case host of an `authority` (`host`, `host:port`, `[::1]:port`).
pub fn host_of(authority: &str) -> String {
    let authority = authority.trim().to_ascii_lowercase();
    if let Some(rest) = authority.strip_prefix('[') {
        return match rest.find(']') {
            Some(end) => format!("[{}]", &rest[..end]),
            None => authority,
        };
    }
    authority.split(':').next().unwrap_or("").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(pairs: &[(&str, &str)]) -> Config {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|k| pairs.iter().find(|(pk, _)| pk == k).map(|(_, v)| v.clone()))
    }

    #[test]
    fn defaults_to_loopback() {
        let c = cfg(&[]);
        assert_eq!(c.bind, "127.0.0.1:8080");
        assert!(c.binds_loopback());
        assert!(c.warnings(|_| false).is_empty());
    }

    #[test]
    fn port_alone_listens_on_every_interface_and_warns_without_a_key() {
        let c = cfg(&[("PORT", "9000")]);
        assert_eq!(c.bind, "0.0.0.0:9000");
        assert_eq!(c.warnings(|_| false).len(), 1);
        assert!(cfg(&[("PORT", "9000"), ("DH_ACCESS_KEY", "k")])
            .warnings(|_| false)
            .is_empty());
    }

    #[test]
    fn names_each_retired_variable_in_one_line() {
        let c = cfg(&[]);
        let w = c.warnings(|v| v == "DH_MASTER_KEY" || v == "GITHUB_CLIENT_ID");
        assert_eq!(w.len(), 1);
        assert!(w[0].contains("DH_MASTER_KEY") && w[0].contains("GITHUB_CLIENT_ID"));
    }

    #[test]
    fn reads_the_public_host() {
        assert_eq!(
            cfg(&[("DH_PUBLIC_URL", "https://Db.Example.com:8443/x")])
                .public_host()
                .as_deref(),
            Some("db.example.com")
        );
        assert_eq!(cfg(&[]).public_host(), None);
    }

    #[test]
    fn dh_bind_wins_over_port() {
        let c = cfg(&[("DH_BIND", "127.0.0.1:7000"), ("PORT", "9000")]);
        assert_eq!(c.bind, "127.0.0.1:7000");
    }

    #[test]
    fn an_empty_variable_counts_as_unset() {
        let c = cfg(&[("DH_BIND", ""), ("PORT", "9000"), ("DH_ACCESS_KEY", ""), ("DH_STATIC_DIR", "")]);
        assert_eq!(c.bind, "0.0.0.0:9000");
        assert_eq!(c.access_key, None);
        assert_eq!(c.static_dir, None);
    }

    #[test]
    fn read_only_is_on_only_for_1_or_true_in_any_case() {
        for on in ["1", "true", "TRUE", "True"] {
            assert!(cfg(&[("DH_READ_ONLY", on)]).read_only, "{on}");
        }
        for off in ["0", "false", "yes", "on", "2"] {
            assert!(!cfg(&[("DH_READ_ONLY", off)]).read_only, "{off}");
        }
        assert!(!cfg(&[]).read_only);
    }

    #[test]
    fn only_a_loopback_address_counts_as_loopback() {
        for (bind, loopback) in [
            ("127.0.0.1:80", true),
            ("[::1]:80", true),
            ("0.0.0.0:80", false),
            ("192.168.1.5:80", false),
            // A name cannot be checked, so it is treated as reachable.
            ("localhost:8080", false),
            ("not an address", false),
        ] {
            let c = cfg(&[("DH_BIND", bind)]);
            assert_eq!(c.binds_loopback(), loopback, "{bind}");
        }
    }

    #[test]
    fn the_open_bind_warning_names_the_address_and_the_key_variable() {
        let w = cfg(&[("DH_BIND", "0.0.0.0:8080")]).warnings(|_| false);
        assert_eq!(w.len(), 1);
        assert!(w[0].contains("0.0.0.0:8080") && w[0].contains("DH_ACCESS_KEY"));
    }

    #[test]
    fn an_open_bind_with_retired_variables_gives_both_warnings() {
        let c = cfg(&[("PORT", "9000")]);
        assert_eq!(c.warnings(|v| v == "DH_DATABASE_URL").len(), 2);
    }

    #[test]
    fn retired_variables_alone_on_loopback_give_one_note_and_no_bind_warning() {
        let w = cfg(&[]).warnings(|v| v == "GOOGLE_CLIENT_SECRET");
        assert_eq!(w.len(), 1);
        assert!(w[0].starts_with("note:") && w[0].contains("GOOGLE_CLIENT_SECRET"));
    }

    #[test]
    fn the_public_host_ignores_scheme_userinfo_path_and_port() {
        for (url, host) in [
            ("https://user:pw@db.example.com/x?y#z", "db.example.com"),
            ("db.example.com:8080", "db.example.com"),
            ("http://[::1]:9000/", "[::1]"),
        ] {
            let c = Config {
                public_url: Some(url.into()),
                ..Default::default()
            };
            assert_eq!(c.public_host().as_deref(), Some(host), "{url}");
        }
        let empty = Config {
            public_url: Some(String::new()),
            ..Default::default()
        };
        assert_eq!(empty.public_host(), None);
    }

    #[test]
    fn host_of_lowers_case_and_drops_the_port() {
        assert_eq!(host_of("LocalHost:80"), "localhost");
        assert_eq!(host_of("  [::1]:8080 "), "[::1]");
        assert_eq!(host_of("example.com"), "example.com");
        assert_eq!(host_of(""), "");
    }
}
