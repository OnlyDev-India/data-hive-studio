use super::format::{self, Header, BIN_FILE, KEY_FILE};
use super::import::{dev_file_name, LegacyRead, LegacySource};
use super::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

fn temp_dir(names: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("dh-secret-store-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    set_names(&dir, names);
    dir
}

fn set_names(dir: &Path, names: &[&str]) {
    let map: serde_json::Map<String, serde_json::Value> = names
        .iter()
        .map(|n| {
            let meta = serde_json::json!({
                "name": n, "kind": "postgres", "host": "h", "port": 5432, "user": "u", "database": "d"
            });
            (n.to_string(), meta)
        })
        .collect();
    std::fs::write(
        dir.join("connections.json"),
        serde_json::to_string(&map).unwrap(),
    )
    .unwrap();
}

/// Keychain stand in. `None` values fail to read.
#[derive(Clone, Default)]
struct Fake {
    entries: Arc<Mutex<HashMap<String, Option<String>>>>,
    deleted: Arc<Mutex<Vec<String>>>,
    /// Set to the store folder to assert `secrets.bin` exists on every delete.
    dir: Option<PathBuf>,
}

impl Fake {
    fn with(entries: &[(&str, Option<&str>)]) -> Self {
        let fake = Fake::default();
        let mut map = fake.entries.lock().unwrap();
        for (k, v) in entries {
            map.insert(k.to_string(), v.map(str::to_string));
        }
        drop(map);
        fake
    }
}

impl LegacySource for Fake {
    fn read(&mut self, account: &str) -> LegacyRead {
        match self.entries.lock().unwrap().get(account) {
            Some(Some(v)) => LegacyRead::Found(v.clone()),
            Some(None) => LegacyRead::Failed,
            None => LegacyRead::Missing,
        }
    }

    fn delete(&mut self, account: &str) {
        if let Some(dir) = &self.dir {
            assert!(
                dir.join(BIN_FILE).exists(),
                "deleted before the file was written"
            );
        }
        self.deleted.lock().unwrap().push(account.to_string());
    }
}

struct Panics;

impl LegacySource for Panics {
    fn read(&mut self, _: &str) -> LegacyRead {
        panic!("the keychain was read");
    }
    fn delete(&mut self, _: &str) {
        panic!("the keychain was touched");
    }
}

fn store_with(dir: &Path, fake: Fake) -> SecretStore {
    SecretStore::with_source(dir.to_path_buf(), Box::new(move || Box::new(fake.clone())))
}

fn store(dir: &Path) -> SecretStore {
    store_with(dir, Fake::default())
}

fn no_keychain(dir: &Path) -> SecretStore {
    SecretStore::with_source(dir.to_path_buf(), Box::new(|| Box::new(Panics)))
}

fn pw(p: &str) -> SecretRecord {
    SecretRecord {
        password: Some(p.into()),
        ..Default::default()
    }
}

fn header(dir: &Path) -> Header {
    let raw = std::fs::read(dir.join(BIN_FILE)).unwrap();
    let end = raw.iter().position(|b| *b == b'\n').unwrap();
    serde_json::from_slice(&raw[..end]).unwrap()
}

#[test]
fn a_saved_record_survives_a_restart() {
    let dir = temp_dir(&["a"]);
    let full = SecretRecord {
        password: Some("hunter2-secret".into()),
        ssh_password: Some("sp".into()),
        ssh_key_passphrase: Some("kp".into()),
    };
    store(&dir).put("a", full.clone()).unwrap();
    assert_eq!(store(&dir).get("a").unwrap(), Some(full));
    let raw = std::fs::read(dir.join(BIN_FILE)).unwrap();
    assert!(!raw.windows(14).any(|w| w == b"hunter2-secret"));
}

#[test]
fn rename_and_remove_move_and_drop_the_record() {
    let dir = temp_dir(&["a", "b"]);
    let s = store(&dir);
    s.put("a", pw("1")).unwrap();
    s.put("b", pw("2")).unwrap();
    s.rename("a", "c").unwrap();
    s.remove("b").unwrap();
    set_names(&dir, &["c"]);
    let reopened = store(&dir);
    assert_eq!(reopened.get("a").unwrap(), None);
    assert_eq!(reopened.get("b").unwrap(), None);
    assert_eq!(reopened.get("c").unwrap(), Some(pw("1")));
}

#[test]
fn records_without_a_connection_are_dropped_on_open() {
    let dir = temp_dir(&["a", "b"]);
    let s = store(&dir);
    s.put("a", pw("1")).unwrap();
    s.put("b", pw("2")).unwrap();
    set_names(&dir, &["a"]);
    let reopened = store(&dir);
    assert_eq!(reopened.get("b").unwrap(), None);
    assert_eq!(reopened.get("a").unwrap(), Some(pw("1")));
}

#[cfg(unix)]
#[test]
fn files_are_private_and_wider_permissions_are_repaired() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir(&["a"]);
    store(&dir).put("a", pw("1")).unwrap();
    let mode = |f: &str| std::fs::metadata(dir.join(f)).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(KEY_FILE), 0o600);
    assert_eq!(mode(BIN_FILE), 0o600);
    for f in [KEY_FILE, BIN_FILE] {
        std::fs::set_permissions(dir.join(f), std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    store(&dir).get("a").unwrap();
    assert_eq!(mode(KEY_FILE), 0o600);
    assert_eq!(mode(BIN_FILE), 0o600);
}

#[test]
fn carry_over_prefers_the_keychain_then_deletes_the_old_copies() {
    let dir = temp_dir(&["a", "b", "c"]);
    let dev = dir.join("connection-passwords");
    std::fs::create_dir_all(&dev).unwrap();
    let dev_key = [7u8; 32];
    std::fs::write(dev.join(".key"), dev_key).unwrap();
    let sealed = |v: &str| format::seal(&dev_key, &[], v.as_bytes()).unwrap();
    std::fs::write(dev.join(dev_file_name("a")), sealed("a-file")).unwrap();
    std::fs::write(
        dev.join(dev_file_name("a::ssh")),
        sealed(r#"{"password":null,"key_passphrase":"kp-file"}"#),
    )
    .unwrap();
    std::fs::write(dev.join(dev_file_name("c")), "c-plain").unwrap();

    let mut fake = Fake::with(&[
        ("a", Some("a-kc")),
        (
            "a::ssh",
            Some(r#"{"password":"sp-kc","key_passphrase":null}"#),
        ),
        ("b", Some("b-kc")),
    ]);
    fake.dir = Some(dir.clone());
    let deleted = fake.deleted.clone();
    let s = store_with(&dir, fake);

    let a = s.get("a").unwrap().unwrap();
    assert_eq!(a.password.as_deref(), Some("a-kc"));
    assert_eq!(a.ssh_password.as_deref(), Some("sp-kc"));
    assert_eq!(a.ssh_key_passphrase.as_deref(), Some("kp-file"));
    assert_eq!(s.get("b").unwrap(), Some(pw("b-kc")));
    assert_eq!(s.get("c").unwrap(), Some(pw("c-plain")));
    assert!(header(&dir).keychain_imported);
    assert!(!dev.exists());
    let mut deleted = deleted.lock().unwrap().clone();
    deleted.sort();
    assert_eq!(deleted, ["a", "a::ssh", "b"]);
    assert_eq!(s.take_notice().unwrap(), None);
}

#[test]
fn after_carry_over_the_keychain_is_never_touched() {
    let dir = temp_dir(&["a"]);
    store_with(&dir, Fake::with(&[("a", Some("1"))]))
        .get("a")
        .unwrap();
    let s = no_keychain(&dir);
    assert_eq!(s.get("a").unwrap(), Some(pw("1")));
    s.put("a", pw("2")).unwrap();
}

#[test]
fn a_failed_keychain_read_is_skipped_reported_and_not_retried() {
    let dir = temp_dir(&["a", "b"]);
    let s = store_with(&dir, Fake::with(&[("a", Some("1")), ("b", None)]));
    assert_eq!(s.get("b").unwrap(), None);
    assert_eq!(
        s.take_notice().unwrap(),
        Some(SecretStoreNotice {
            kind: NoticeKind::ImportPartial,
            names: vec!["b".into()]
        })
    );
    assert_eq!(s.take_notice().unwrap(), None);
    assert_eq!(no_keychain(&dir).get("a").unwrap(), Some(pw("1")));
}

fn assert_reset(dir: &Path) {
    let s = no_keychain(dir);
    assert_eq!(s.get("a").unwrap(), None);
    assert!(header(dir).keychain_imported);
    assert_eq!(
        s.take_notice().unwrap(),
        Some(SecretStoreNotice::new(NoticeKind::KeyReset))
    );
    assert_eq!(s.take_notice().unwrap(), None);
    s.put("a", pw("new")).unwrap();
    assert_eq!(no_keychain(dir).get("a").unwrap(), Some(pw("new")));
    assert!(dir.join("connections.json").exists());
}

fn saved_dir() -> PathBuf {
    let dir = temp_dir(&["a"]);
    store(&dir).put("a", pw("1")).unwrap();
    dir
}

#[test]
fn a_missing_key_resets_the_secrets_only() {
    let dir = saved_dir();
    std::fs::remove_file(dir.join(KEY_FILE)).unwrap();
    assert_reset(&dir);
}

#[test]
fn a_damaged_key_file_resets() {
    let dir = saved_dir();
    std::fs::write(
        dir.join(KEY_FILE),
        r#"{"v":1,"kind":"plain","key":"c2hvcnQ="}"#,
    )
    .unwrap();
    assert_reset(&dir);
}

#[test]
fn a_flipped_ciphertext_byte_resets() {
    let dir = saved_dir();
    let mut raw = std::fs::read(dir.join(BIN_FILE)).unwrap();
    let last = raw.len() - 1;
    raw[last] ^= 1;
    std::fs::write(dir.join(BIN_FILE), raw).unwrap();
    assert_reset(&dir);
}

#[test]
fn an_edited_header_resets() {
    let dir = saved_dir();
    let raw = std::fs::read(dir.join(BIN_FILE)).unwrap();
    let edited = [b" ".as_slice(), &raw].concat();
    std::fs::write(dir.join(BIN_FILE), edited).unwrap();
    assert_reset(&dir);
}

#[test]
fn a_newer_file_is_read_only_and_never_written() {
    let dir = saved_dir();
    let raw = std::fs::read(dir.join(BIN_FILE)).unwrap();
    let end = raw.iter().position(|b| *b == b'\n').unwrap();
    let newer = [
        br#"{"v":2,"keychain_imported":true}"#.as_slice(),
        &raw[end..],
    ]
    .concat();
    std::fs::write(dir.join(BIN_FILE), &newer).unwrap();
    let key_before = std::fs::read(dir.join(KEY_FILE)).unwrap();

    let s = no_keychain(&dir);
    assert_eq!(s.get("a").unwrap(), None);
    assert_eq!(s.put("a", pw("2")).unwrap_err(), NEWER_VERSION);
    s.rename("a", "b").unwrap();
    s.remove("a").unwrap();
    assert_eq!(
        s.take_notice().unwrap(),
        Some(SecretStoreNotice::new(NoticeKind::NewerVersion))
    );
    assert_eq!(std::fs::read(dir.join(BIN_FILE)).unwrap(), newer);
    assert_eq!(std::fs::read(dir.join(KEY_FILE)).unwrap(), key_before);
}

#[test]
fn a_newer_key_file_is_read_only_too() {
    let dir = saved_dir();
    std::fs::write(dir.join(KEY_FILE), r#"{"v":2,"kind":"wrapped"}"#).unwrap();
    let bin_before = std::fs::read(dir.join(BIN_FILE)).unwrap();
    let s = no_keychain(&dir);
    assert_eq!(s.put("a", pw("2")).unwrap_err(), NEWER_VERSION);
    assert_eq!(std::fs::read(dir.join(BIN_FILE)).unwrap(), bin_before);
}

#[test]
fn a_leftover_tmp_file_is_ignored_and_replaced() {
    let dir = saved_dir();
    std::fs::write(dir.join(format!("{BIN_FILE}.tmp")), b"half a write").unwrap();
    let s = no_keychain(&dir);
    assert_eq!(s.get("a").unwrap(), Some(pw("1")));
    s.put("a", pw("2")).unwrap();
    assert!(!dir.join(format!("{BIN_FILE}.tmp")).exists());
    assert_eq!(no_keychain(&dir).get("a").unwrap(), Some(pw("2")));
}

#[test]
fn concurrent_puts_all_land() {
    let names: Vec<String> = (0..16).map(|i| format!("c{i}")).collect();
    let dir = temp_dir(&names.iter().map(String::as_str).collect::<Vec<_>>());
    let s = Arc::new(store(&dir));
    let threads: Vec<_> = names
        .iter()
        .cloned()
        .map(|n| {
            let s = s.clone();
            std::thread::spawn(move || s.put(&n, pw(&n)).unwrap())
        })
        .collect();
    for t in threads {
        t.join().unwrap();
    }
    let reopened = no_keychain(&dir);
    for n in &names {
        assert_eq!(reopened.get(n).unwrap(), Some(pw(n)));
    }
}
