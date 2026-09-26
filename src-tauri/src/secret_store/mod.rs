//! Saved connection secrets, sealed in `secrets.bin` with the key in
//! `secrets.key`, both in the app data folder. Dev and release builds share
//! this one path; the OS Keychain is only read once, to carry old entries
//! over (`import.rs`).
//!
//! The whole map lives in memory once opened. Every write rewrites the file
//! under the store's lock, so concurrent commands never lose a change.

mod format;
mod import;
#[cfg(test)]
mod tests;

use format::{BinRead, Header, Key, KeyRead, SecretMap};
use import::LegacySource;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub use format::SecretRecord;

pub const NEWER_VERSION: &str =
    "Saved passwords were made by a newer version of DH Studio. Update the app to save passwords.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    KeyReset,
    ImportPartial,
    NewerVersion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SecretStoreNotice {
    pub kind: NoticeKind,
    pub names: Vec<String>,
}

impl SecretStoreNotice {
    fn new(kind: NoticeKind) -> Self {
        Self {
            kind,
            names: Vec::new(),
        }
    }
}

type SourceFactory = Box<dyn Fn() -> Box<dyn LegacySource> + Send + Sync>;

pub struct SecretStore {
    dir: PathBuf,
    legacy: SourceFactory,
    state: Mutex<Option<Opened>>,
}

struct Opened {
    dir: PathBuf,
    key: Key,
    header: Header,
    map: SecretMap,
    notice: Option<SecretStoreNotice>,
    read_only: bool,
}

impl SecretStore {
    pub fn new(dir: PathBuf) -> Self {
        Self::with_source(dir, Box::new(|| Box::new(import::Keychain)))
    }

    fn with_source(dir: PathBuf, legacy: SourceFactory) -> Self {
        Self {
            dir,
            legacy,
            state: Mutex::new(None),
        }
    }

    /// Opens on first use, so the first secret call of the process runs any
    /// carry over.
    fn with<R>(&self, f: impl FnOnce(&mut Opened) -> Result<R, String>) -> Result<R, String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.is_none() {
            let mut source = (self.legacy)();
            *state = Some(Opened::open(&self.dir, source.as_mut())?);
        }
        f(state.as_mut().expect("opened above"))
    }

    pub fn get(&self, name: &str) -> Result<Option<SecretRecord>, String> {
        self.with(|o| Ok(o.map.get(name).cloned()))
    }

    /// An empty record removes the entry.
    pub fn put(&self, name: &str, record: SecretRecord) -> Result<(), String> {
        self.with(|o| {
            if o.read_only {
                return Err(NEWER_VERSION.into());
            }
            let mut next = o.map.clone();
            if record.is_empty() {
                next.remove(name);
            } else {
                next.insert(name.to_string(), record);
            }
            o.commit(next)
        })
    }

    pub fn rename(&self, old: &str, new: &str) -> Result<(), String> {
        self.with(|o| {
            if o.read_only || old == new {
                return Ok(());
            }
            let mut next = o.map.clone();
            match next.remove(old) {
                Some(record) => next.insert(new.to_string(), record),
                None => next.remove(new),
            };
            o.commit(next)
        })
    }

    pub fn remove(&self, name: &str) -> Result<(), String> {
        self.with(|o| {
            if o.read_only {
                return Ok(());
            }
            let mut next = o.map.clone();
            next.remove(name);
            o.commit(next)
        })
    }

    /// The notice queued while opening, once; `None` after that.
    pub fn take_notice(&self) -> Result<Option<SecretStoreNotice>, String> {
        self.with(|o| Ok(o.notice.take()))
    }
}

impl Opened {
    fn open(dir: &Path, source: &mut dyn LegacySource) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let names = crate::local_connections::saved_names_in(dir)?;
        let key = format::read_key(dir);
        let found_key = match key {
            KeyRead::Found(k) => Some(k),
            _ => None,
        };
        let bin = match key {
            KeyRead::Newer => BinRead::Newer,
            _ => format::read_bin(dir, found_key.as_ref()),
        };
        let mut opened = Opened {
            dir: dir.to_path_buf(),
            key: [0; 32],
            header: Header {
                v: format::VERSION,
                keychain_imported: true,
            },
            map: SecretMap::new(),
            notice: None,
            read_only: false,
        };
        match bin {
            BinRead::Newer => {
                opened.read_only = true;
                opened.notice = Some(SecretStoreNotice::new(NoticeKind::NewerVersion));
            }
            BinRead::Opened(header, map) => {
                opened.key = found_key.expect("a sealed file only opens with a key");
                opened.header = header;
                opened.map = map;
            }
            BinRead::Absent => {
                opened.key = match found_key {
                    Some(k) => k,
                    None => opened.new_key()?,
                };
                opened.header.keychain_imported = false;
            }
            BinRead::Damaged => {
                opened.new_key()?;
                opened.write(&opened.map)?;
                opened.notice = Some(SecretStoreNotice::new(NoticeKind::KeyReset));
            }
        }
        if !opened.read_only {
            if opened.header.keychain_imported {
                let mut next = opened.map.clone();
                next.retain(|name, _| names.contains(name));
                opened.commit(next)?;
            } else {
                opened.carry_over(&names, source)?;
            }
        }
        format::repair_permissions(&dir.join(format::KEY_FILE));
        format::repair_permissions(&dir.join(format::BIN_FILE));
        Ok(opened)
    }

    fn carry_over(
        &mut self,
        names: &[String],
        source: &mut dyn LegacySource,
    ) -> Result<(), String> {
        let collected = import::collect(&self.dir, names, source);
        let mut next = collected.map;
        for (name, record) in std::mem::take(&mut self.map) {
            next.insert(name, record);
        }
        next.retain(|name, _| names.contains(name));
        self.header.keychain_imported = true;
        self.write(&next)?;
        self.map = next;
        import::forget(&self.dir, &collected.found, source);
        if !collected.failed.is_empty() {
            self.notice = Some(SecretStoreNotice {
                kind: NoticeKind::ImportPartial,
                names: collected.failed,
            });
        }
        Ok(())
    }

    fn new_key(&mut self) -> Result<Key, String> {
        let key = format::new_key();
        format::write_key(&self.dir, &key)?;
        self.key = key;
        Ok(key)
    }

    fn write(&self, map: &SecretMap) -> Result<(), String> {
        format::write_bin(&self.dir, &self.key, &self.header, map)
    }

    /// Writes only when `next` differs, then keeps it.
    fn commit(&mut self, next: SecretMap) -> Result<(), String> {
        if next == self.map {
            return Ok(());
        }
        self.write(&next)?;
        self.map = next;
        Ok(())
    }
}

pub fn store(app: &tauri::AppHandle) -> Result<tauri::State<'_, SecretStore>, String> {
    app.try_state::<SecretStore>()
        .ok_or_else(|| "saved passwords are not available yet".to_string())
}

#[tauri::command]
pub fn take_secret_store_notice(
    app: tauri::AppHandle,
) -> Result<Option<SecretStoreNotice>, String> {
    store(&app)?.take_notice()
}
