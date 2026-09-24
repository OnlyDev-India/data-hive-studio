//! One time cleanup of what the removed team server screens left behind
//! (spec 0010): the saved server profile file and the sign in tokens the app
//! kept for each server. It runs at every start but only does anything while
//! the profile file exists, and deleting that file is the last step, so a
//! second launch finds nothing to do.

use tauri::Manager;

/// The keychain service the old sign in tokens used.
#[cfg(not(debug_assertions))]
const KEYRING_SERVICE: &str = "dh-studio-server";

#[derive(serde::Deserialize)]
struct OldProfile {
    id: String,
    #[serde(default)]
    url: String,
}

pub fn cleanup(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        cleanup_in(&dir);
    }
}

fn cleanup_in(dir: &std::path::Path) {
    let file = dir.join("servers.json");
    if !file.exists() {
        return;
    }
    // A file that will not parse still gets deleted; there is just nothing
    // to look up in the keychain for it.
    let profiles: Vec<OldProfile> = std::fs::read_to_string(&file)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok())
        .map(|rows| {
            rows.into_iter()
                .filter_map(|r| serde_json::from_value(r).ok())
                .collect()
        })
        .unwrap_or_default();
    for p in &profiles {
        forget_tokens(&p.id, &p.url);
    }
    // Debug builds kept the tokens in files instead of the keychain.
    let _ = std::fs::remove_dir_all(dir.join("server-tokens"));
    let _ = std::fs::remove_file(&file);
}

/// Delete the two keychain entries an old profile could have: one per server
/// address, and the older one per profile id.
#[cfg(not(debug_assertions))]
fn forget_tokens(id: &str, url: &str) {
    let base = url.trim().trim_end_matches('/');
    let base = if base.starts_with("http") {
        base.to_string()
    } else {
        format!("https://{base}")
    };
    for account in [format!("refresh:{base}"), id.to_string()] {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, &account) {
            let _ = entry.delete_credential();
        }
    }
}

#[cfg(debug_assertions)]
fn forget_tokens(_id: &str, _url: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deletes_the_profile_file_and_token_folder_once_and_then_does_nothing() {
        let dir = std::env::temp_dir().join(format!("dh-legacy-servers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("server-tokens")).unwrap();
        std::fs::write(
            dir.join("servers.json"),
            r#"[{"id":"a","name":"x","url":"https://s","org_id":"o"},{"bad":1}]"#,
        )
        .unwrap();
        std::fs::write(dir.join("server-tokens").join("t"), "x").unwrap();
        std::fs::write(dir.join("local-connections.json"), "keep").unwrap();

        cleanup_in(&dir);
        assert!(!dir.join("servers.json").exists());
        assert!(!dir.join("server-tokens").exists());
        assert!(dir.join("local-connections.json").exists());

        // A second launch changes nothing, even if a token folder appears.
        std::fs::create_dir_all(dir.join("server-tokens")).unwrap();
        cleanup_in(&dir);
        assert!(dir.join("server-tokens").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_profile_file_is_still_deleted() {
        let dir =
            std::env::temp_dir().join(format!("dh-legacy-servers-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("servers.json"), "not json").unwrap();
        cleanup_in(&dir);
        assert!(!dir.join("servers.json").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
