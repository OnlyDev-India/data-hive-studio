//! Live handles: an in memory map with a cap and an idle timeout (AC-9). It
//! never closes anything itself; it returns the values it dropped so the
//! caller can close their pools.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const MAX_HANDLES: usize = 32;
pub const IDLE: Duration = Duration::from_secs(15 * 60);

pub struct Registry<T> {
    max: usize,
    idle: Duration,
    map: Mutex<HashMap<String, (T, Instant)>>,
}

impl<T: Clone> Registry<T> {
    pub fn new(max: usize, idle: Duration) -> Self {
        Self {
            max,
            idle,
            map: Mutex::new(HashMap::new()),
        }
    }

    /// The value for `handle`, marked as just used. Also returns whatever
    /// went idle, for the caller to close. An idle handle is unknown.
    pub fn get(&self, handle: &str) -> (Option<T>, Vec<T>) {
        let mut map = self.map.lock().unwrap();
        let expired = Self::drop_idle(&mut map, self.idle);
        let found = map.get_mut(handle).map(|(v, last)| {
            *last = Instant::now();
            v.clone()
        });
        (found, expired)
    }

    /// Add a value. At the cap, the least recently used handle goes first.
    /// Returns everything dropped, for the caller to close.
    pub fn insert(&self, handle: String, value: T) -> Vec<T> {
        let mut map = self.map.lock().unwrap();
        let mut dropped = Self::drop_idle(&mut map, self.idle);
        while map.len() >= self.max {
            let oldest = map
                .iter()
                .min_by_key(|(_, (_, last))| *last)
                .map(|(k, _)| k.clone());
            match oldest.and_then(|k| map.remove(&k)) {
                Some((v, _)) => dropped.push(v),
                None => break,
            }
        }
        map.insert(handle, (value, Instant::now()));
        dropped
    }

    pub fn remove(&self, handle: &str) -> Option<T> {
        self.map.lock().unwrap().remove(handle).map(|(v, _)| v)
    }

    /// Drop every idle handle (the background sweep).
    pub fn sweep(&self) -> Vec<T> {
        Self::drop_idle(&mut self.map.lock().unwrap(), self.idle)
    }

    pub fn len(&self) -> usize {
        self.map.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn drop_idle(map: &mut HashMap<String, (T, Instant)>, idle: Duration) -> Vec<T> {
        let now = Instant::now();
        let stale: Vec<String> = map
            .iter()
            .filter(|(_, (_, last))| now.duration_since(*last) >= idle)
            .map(|(k, _)| k.clone())
            .collect();
        stale
            .into_iter()
            .filter_map(|k| map.remove(&k))
            .map(|(v, _)| v)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_33rd_handle_evicts_the_least_recently_used() {
        let r = Registry::new(MAX_HANDLES, IDLE);
        for i in 0..MAX_HANDLES {
            assert!(r.insert(format!("h{i}"), i).is_empty());
            std::thread::sleep(Duration::from_millis(1));
        }
        // Touch h0 so h1 becomes the oldest.
        assert_eq!(r.get("h0").0, Some(0));
        let dropped = r.insert("new".into(), 99);
        assert_eq!(dropped, vec![1]);
        assert_eq!(r.len(), MAX_HANDLES);
        assert_eq!(r.get("h1").0, None);
        assert_eq!(r.get("h0").0, Some(0));
    }

    #[test]
    fn an_idle_handle_is_unknown_and_handed_back_to_close() {
        let r = Registry::new(4, Duration::from_millis(20));
        r.insert("a".into(), 1);
        std::thread::sleep(Duration::from_millis(40));
        let (found, expired) = r.get("a");
        assert_eq!(found, None);
        assert_eq!(expired, vec![1]);
        assert!(r.is_empty());
    }

    #[test]
    fn using_a_handle_keeps_it_alive_and_remove_frees_it() {
        let r = Registry::new(4, Duration::from_millis(60));
        r.insert("a".into(), 1);
        for _ in 0..3 {
            std::thread::sleep(Duration::from_millis(30));
            assert_eq!(r.get("a").0, Some(1));
        }
        assert_eq!(r.remove("a"), Some(1));
        assert_eq!(r.remove("a"), None);
    }

    #[test]
    fn the_sweep_hands_back_only_idle_handles() {
        let r = Registry::new(4, Duration::from_millis(80));
        r.insert("old".into(), 1);
        std::thread::sleep(Duration::from_millis(120));
        r.insert("fresh".into(), 2);
        // Inserting already dropped "old", so the sweep finds nothing idle.
        assert!(r.sweep().is_empty());
        assert_eq!(r.get("fresh").0, Some(2));
    }

    #[test]
    fn the_sweep_returns_an_idle_value_for_the_caller_to_close() {
        let r = Registry::new(4, Duration::from_millis(20));
        r.insert("a".into(), 7);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(r.sweep(), vec![7]);
        assert!(r.is_empty());
    }

    #[test]
    fn a_cap_of_one_keeps_only_the_newest_handle() {
        let r = Registry::new(1, IDLE);
        assert!(r.insert("a".into(), 1).is_empty());
        assert_eq!(r.insert("b".into(), 2), vec![1]);
        assert_eq!((r.get("a").0, r.get("b").0), (None, Some(2)));
    }

    #[test]
    fn an_unknown_handle_returns_nothing_and_drops_nothing() {
        let r: Registry<i32> = Registry::new(4, IDLE);
        assert_eq!(r.get("missing"), (None, vec![]));
        assert!(r.sweep().is_empty());
    }
}
