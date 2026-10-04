//! The saved queries and snippets library: `library.json` in the app data
//! folder. The frontend owns every rule (`src/shared/library/rules.ts`); this
//! side only checks the file shape on load, writes atomically, and backs up a
//! file it cannot read.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Query,
    Snippet,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemLanguage {
    Sql,
    Mongo,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LibraryItem {
    pub id: String,
    pub kind: ItemKind,
    pub language: ItemLanguage,
    pub name: String,
    pub text: String,
    #[serde(default)]
    pub trigger: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LibraryFile {
    pub version: u32,
    pub seeded: bool,
    pub items: Vec<LibraryItem>,
}

impl LibraryFile {
    fn empty(seeded: bool) -> Self {
        Self {
            version: 1,
            seeded,
            items: Vec::new(),
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct LoadResult {
    pub file: LibraryFile,
    pub recovered_backup: Option<String>,
}

fn library_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("library.json"))
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

fn parse(raw: &str) -> Option<LibraryFile> {
    let file: LibraryFile = serde_json::from_str(raw).ok()?;
    (file.version == 1).then_some(file)
}

/// Reads the library. A missing file is a fresh, unseeded library. A file
/// that cannot be read or parsed is renamed to `library.json.bad` (replacing
/// an older backup) and replaced by an empty, seeded one, so the starters are
/// not added again.
pub fn load_from(path: &Path) -> Result<LoadResult, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => Some(raw),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LoadResult {
                file: LibraryFile::empty(false),
                recovered_backup: None,
            });
        }
        Err(_) => None,
    };
    if let Some(file) = raw.as_deref().and_then(parse) {
        return Ok(LoadResult {
            file,
            recovered_backup: None,
        });
    }
    let backup = with_suffix(path, ".bad");
    std::fs::rename(path, &backup).map_err(|e| format!("Could not back up the library: {e}"))?;
    let file = LibraryFile::empty(true);
    save_to(path, &file)?;
    Ok(LoadResult {
        file,
        recovered_backup: Some(backup.to_string_lossy().into_owned()),
    })
}

/// Writes the whole library to a temp file, then renames it over the old one,
/// so the file on disk is always one complete version or the other.
pub fn save_to(path: &Path, file: &LibraryFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    let tmp = with_suffix(path, ".tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("Could not write the library: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save the library: {e}")
    })
}

#[tauri::command]
pub fn library_load(app: AppHandle) -> Result<LoadResult, String> {
    load_from(&library_path(&app)?)
}

#[tauri::command]
pub fn library_save(app: AppHandle, file: LibraryFile) -> Result<(), String> {
    save_to(&library_path(&app)?, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("dh-library-{name}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn item(id: &str) -> LibraryItem {
        LibraryItem {
            id: id.into(),
            kind: ItemKind::Snippet,
            language: ItemLanguage::Sql,
            name: "Select rows".into(),
            text: "SELECT ${1:*} FROM ${2:table};".into(),
            trigger: Some("sel".into()),
            created_at: 1,
            updated_at: 2,
        }
    }

    #[test]
    fn missing_file_is_an_unseeded_library() {
        let path = temp_dir("missing").join("library.json");
        let got = load_from(&path).unwrap();
        assert_eq!(got.file, LibraryFile::empty(false));
        assert_eq!(got.recovered_backup, None);
        assert!(!path.exists());
    }

    #[test]
    fn save_then_load_round_trips() {
        let path = temp_dir("round").join("library.json");
        let file = LibraryFile {
            version: 1,
            seeded: true,
            items: vec![item("a")],
        };
        save_to(&path, &file).unwrap();
        assert!(!with_suffix(&path, ".tmp").exists());
        assert_eq!(load_from(&path).unwrap().file, file);
    }

    #[test]
    fn truncated_file_is_backed_up_and_reset_seeded() {
        let path = temp_dir("truncated").join("library.json");
        std::fs::write(&path, r#"{"version":1,"seeded":true,"items":[{"id":"#).unwrap();
        let got = load_from(&path).unwrap();
        assert_eq!(got.file, LibraryFile::empty(true));
        let backup = with_suffix(&path, ".bad");
        assert_eq!(
            got.recovered_backup.as_deref(),
            Some(backup.to_string_lossy().as_ref())
        );
        assert!(std::fs::read_to_string(&backup)
            .unwrap()
            .starts_with("{\"version\""));
        // The reset file is saved, so the next start neither recovers nor seeds again.
        let again = load_from(&path).unwrap();
        assert_eq!(
            again,
            LoadResult {
                file: LibraryFile::empty(true),
                recovered_backup: None
            }
        );
    }

    #[test]
    fn wrong_version_or_shape_is_recovered() {
        for raw in [
            r#"{"version":2,"seeded":true,"items":[]}"#,
            r#"{"version":1,"items":[]}"#,
            r#"{"version":1,"seeded":true,"items":[{"id":"a","kind":"macro"}]}"#,
        ] {
            let path = temp_dir("shape").join("library.json");
            std::fs::write(&path, raw).unwrap();
            let got = load_from(&path).unwrap();
            assert!(got.recovered_backup.is_some(), "{raw}");
            assert!(got.file.items.is_empty());
        }
    }

    #[test]
    fn a_new_backup_replaces_an_older_one() {
        let path = temp_dir("replace").join("library.json");
        let backup = with_suffix(&path, ".bad");
        std::fs::write(&backup, "old").unwrap();
        std::fs::write(&path, "new garbage").unwrap();
        load_from(&path).unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "new garbage");
    }
}
