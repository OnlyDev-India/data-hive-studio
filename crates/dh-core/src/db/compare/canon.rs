//! Canonical values for the data diff: the one key order every scan is
//! checked against, and the type aware cell equality.

use std::cmp::Ordering;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};

use crate::api::KeyVal;

/// An exact decimal: `digits × 10^exp`, with no leading or trailing zeros in
/// `digits`. Zero has empty digits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Dec {
    neg: bool,
    digits: String,
    exp: i64,
}

/// Exponents past this are not numbers anyone stores; they stay text.
const MAX_EXP: i64 = 10_000;

impl Dec {
    pub fn parse(text: &str) -> Option<Dec> {
        let s = text.trim();
        let (neg, s) = match s.as_bytes().first()? {
            b'-' => (true, &s[1..]),
            b'+' => (false, &s[1..]),
            _ => (false, s),
        };
        let (mantissa, e) = match s.find(['e', 'E']) {
            Some(at) => (&s[..at], s[at + 1..].parse::<i64>().ok()?),
            None => (s, 0),
        };
        let (int, frac) = mantissa.split_once('.').unwrap_or((mantissa, ""));
        if int.is_empty() && frac.is_empty() {
            return None;
        }
        if !int.bytes().chain(frac.bytes()).all(|b| b.is_ascii_digit()) || e.abs() > MAX_EXP {
            return None;
        }
        let all = format!("{int}{frac}");
        let lead = all.trim_start_matches('0');
        let digits = lead.trim_end_matches('0');
        if digits.is_empty() {
            return Some(Dec::zero());
        }
        let exp = e - frac.len() as i64 + (lead.len() - digits.len()) as i64;
        Some(Dec { neg, digits: digits.to_string(), exp })
    }

    fn zero() -> Dec {
        Dec { neg: false, digits: String::new(), exp: 0 }
    }

    pub fn from_i64(v: i64) -> Dec {
        Dec::parse(&v.to_string()).unwrap_or_else(Dec::zero)
    }

    /// `None` for NaN and infinity.
    pub fn from_f64(v: f64) -> Option<Dec> {
        if !v.is_finite() {
            return None;
        }
        // Display is the shortest text that reads back as `v`, never in
        // exponent form, and keeps the order of distinct values.
        Dec::parse(&v.to_string())
    }

    fn sign(&self) -> i8 {
        match (self.digits.is_empty(), self.neg) {
            (true, _) => 0,
            (false, true) => -1,
            (false, false) => 1,
        }
    }

    /// Plain decimal text, no exponent.
    pub fn to_plain(&self) -> String {
        if self.digits.is_empty() {
            return "0".into();
        }
        let sign = if self.neg { "-" } else { "" };
        let len = self.digits.len() as i64;
        if self.exp >= 0 {
            return format!("{sign}{}{}", self.digits, "0".repeat(self.exp as usize));
        }
        let point = len + self.exp;
        if point > 0 {
            let (a, b) = self.digits.split_at(point as usize);
            format!("{sign}{a}.{b}")
        } else {
            format!("{sign}0.{}{}", "0".repeat((-point) as usize), self.digits)
        }
    }

    pub fn is_integer(&self) -> bool {
        self.exp >= 0
    }

    fn cmp_mag(&self, o: &Dec) -> Ordering {
        let a = self.digits.len() as i64 + self.exp;
        let b = o.digits.len() as i64 + o.exp;
        // Same leading digit position: digit strings compare left to right,
        // and a longer one that starts with the shorter is larger.
        a.cmp(&b).then_with(|| self.digits.cmp(&o.digits))
    }
}

impl Ord for Dec {
    fn cmp(&self, o: &Dec) -> Ordering {
        let (a, b) = (self.sign(), o.sign());
        if a != b || a == 0 {
            return a.cmp(&b);
        }
        let mag = self.cmp_mag(o);
        if a < 0 { mag.reverse() } else { mag }
    }
}

impl PartialOrd for Dec {
    fn partial_cmp(&self, o: &Dec) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// A decoded cell or key value, independent of the engine it came from.
#[derive(Debug, Clone)]
pub enum CanonVal {
    Null,
    Num(Dec),
    Text(String),
    Json(serde_json::Value),
    Bytes(Vec<u8>),
    Uuid([u8; 16]),
    Oid([u8; 12]),
    Bool(bool),
    /// Nanoseconds since the Unix epoch, UTC.
    Ts(i128),
    Other(String),
}

impl CanonVal {
    /// Cross type order: numbers, then text, then documents, then binary
    /// (SQLite's and MongoDB's own orders agree with this).
    fn rank(&self) -> u8 {
        match self {
            CanonVal::Null => 0,
            CanonVal::Num(_) => 1,
            CanonVal::Text(_) => 2,
            CanonVal::Json(_) => 3,
            CanonVal::Bytes(_) => 4,
            CanonVal::Uuid(_) => 5,
            CanonVal::Oid(_) => 6,
            CanonVal::Bool(_) => 7,
            CanonVal::Ts(_) => 8,
            CanonVal::Other(_) => 9,
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, CanonVal::Null)
    }
}

/// The key order. Text compares byte by byte (SQLite BINARY, Postgres "C").
pub fn cmp_vals(a: &CanonVal, b: &CanonVal) -> Ordering {
    use CanonVal::*;
    match (a, b) {
        (Num(x), Num(y)) => x.cmp(y),
        (Text(x), Text(y)) => x.as_bytes().cmp(y.as_bytes()),
        (Json(x), Json(y)) => x.to_string().cmp(&y.to_string()),
        (Bytes(x), Bytes(y)) => x.cmp(y),
        (Uuid(x), Uuid(y)) => x.cmp(y),
        (Oid(x), Oid(y)) => x.cmp(y),
        (Bool(x), Bool(y)) => x.cmp(y),
        (Ts(x), Ts(y)) => x.cmp(y),
        (Other(x), Other(y)) => x.cmp(y),
        _ => a.rank().cmp(&b.rank()),
    }
}

pub fn cmp_keys(a: &[CanonVal], b: &[CanonVal]) -> Ordering {
    for (x, y) in a.iter().zip(b) {
        let o = cmp_vals(x, y);
        if o != Ordering::Equal {
            return o;
        }
    }
    a.len().cmp(&b.len())
}

/// Cell equality: numbers by value, timestamps as instants, documents by
/// structure (key order ignored, array order kept), NULL only equals NULL,
/// text exactly.
pub fn same(a: &CanonVal, b: &CanonVal) -> bool {
    use CanonVal::*;
    match (a, b) {
        (Null, Null) => true,
        (Json(x), Json(y)) => json_same(x, y),
        (Null, _) | (_, Null) => false,
        _ if a.rank() != b.rank() => false,
        _ => cmp_vals(a, b) == Ordering::Equal,
    }
}

fn json_same(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value::*;
    match (a, b) {
        (Number(x), Number(y)) => match (Dec::parse(&x.to_string()), Dec::parse(&y.to_string())) {
            (Some(x), Some(y)) => x == y,
            _ => x == y,
        },
        (Array(x), Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| json_same(p, q)),
        (Object(x), Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| json_same(v, w)))
        }
        _ => a == b,
    }
}

/// Text in the common timestamp shapes, as an instant. A time with no zone
/// is read as UTC.
pub fn parse_ts(text: &str) -> Option<i128> {
    let s = text.trim();
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(instant(t.with_timezone(&Utc)));
    }
    for f in ["%Y-%m-%d %H:%M:%S%.f%:z", "%Y-%m-%d %H:%M:%S%.f%#z"] {
        if let Ok(t) = DateTime::parse_from_str(s, f) {
            return Some(instant(t.with_timezone(&Utc)));
        }
    }
    for f in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M"] {
        if let Ok(t) = NaiveDateTime::parse_from_str(s, f) {
            return Some(instant(t.and_utc()));
        }
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|t| instant(t.and_utc()))
}

pub fn instant(t: DateTime<Utc>) -> i128 {
    t.timestamp() as i128 * 1_000_000_000 + t.timestamp_subsec_nanos() as i128
}

pub(super) fn ts_text(nanos: i128) -> String {
    let secs = nanos.div_euclid(1_000_000_000) as i64;
    let sub = nanos.rem_euclid(1_000_000_000) as u32;
    DateTime::from_timestamp(secs, sub)
        .map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true))
        .unwrap_or_else(|| nanos.to_string())
}

/// The wire form of a key value.
pub fn to_key(v: &CanonVal) -> KeyVal {
    match v {
        CanonVal::Num(d) if d.is_integer() => KeyVal::Int(d.to_plain()),
        CanonVal::Num(d) => KeyVal::Num(d.to_plain()),
        CanonVal::Text(s) => KeyVal::Text(s.clone()),
        CanonVal::Bytes(b) => KeyVal::Bytes(B64.encode(b)),
        CanonVal::Bool(b) => KeyVal::Bool(*b),
        CanonVal::Ts(n) => KeyVal::Ts(ts_text(*n)),
        CanonVal::Uuid(u) => KeyVal::Uuid(uuid::Uuid::from_bytes(*u).to_string()),
        CanonVal::Oid(o) => KeyVal::Oid(hex::encode(o)),
        CanonVal::Json(j) => KeyVal::Ejson(j.to_string()),
        CanonVal::Other(s) => KeyVal::Ejson(s.clone()),
        CanonVal::Null => KeyVal::Ejson("null".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use CanonVal::*;

    fn n(s: &str) -> CanonVal {
        Num(Dec::parse(s).unwrap())
    }

    #[test]
    fn decimals_normalize_and_print_plain() {
        for (text, plain) in [
            ("1", "1"),
            ("1.0", "1"),
            ("0010.500", "10.5"),
            ("-0.0", "0"),
            ("1e3", "1000"),
            ("1.5E-3", "0.0015"),
            ("-12.34", "-12.34"),
            (".5", "0.5"),
        ] {
            assert_eq!(Dec::parse(text).unwrap().to_plain(), plain, "{text}");
        }
        assert!(Dec::parse("abc").is_none());
        assert!(Dec::parse("1.2.3").is_none());
        assert!(Dec::parse("").is_none());
    }

    #[test]
    fn numbers_order_by_value() {
        let sorted = ["-100", "-2.5", "-2", "0", "0.001", "1", "1.25", "1.3", "12", "100"];
        for w in sorted.windows(2) {
            assert_eq!(cmp_vals(&n(w[0]), &n(w[1])), Ordering::Less, "{} < {}", w[0], w[1]);
        }
        assert_eq!(cmp_vals(&n("1"), &n("1.000")), Ordering::Equal);
    }

    #[test]
    fn an_integer_equals_the_same_numeric_and_float() {
        assert!(same(&Num(Dec::from_i64(1)), &n("1.0")));
        assert!(same(&Num(Dec::from_f64(1.0).unwrap()), &Num(Dec::from_i64(1))));
        assert!(!same(&n("1"), &n("1.0001")));
    }

    #[test]
    fn a_large_integer_is_not_rounded_through_a_float() {
        let big = Num(Dec::from_i64(9_007_199_254_740_993));
        let float = Num(Dec::from_f64(9_007_199_254_740_992.0).unwrap());
        assert_eq!(cmp_vals(&float, &big), Ordering::Less);
    }

    #[test]
    fn text_compares_exactly_and_by_bytes() {
        assert!(!same(&Text("a".into()), &Text("a ".into())));
        assert!(!same(&Text("a".into()), &Text("A".into())));
        assert_eq!(cmp_vals(&Text("B".into()), &Text("a".into())), Ordering::Less);
        assert_eq!(cmp_vals(&Text("z".into()), &Text("é".into())), Ordering::Less);
    }

    #[test]
    fn null_equals_only_null() {
        assert!(same(&Null, &Null));
        assert!(!same(&Null, &Text(String::new())));
        assert!(!same(&n("0"), &Null));
    }

    #[test]
    fn documents_ignore_key_order_but_keep_array_order() {
        let a: serde_json::Value = serde_json::from_str(r#"{"a":1,"b":[1,2],"c":{"x":1.0}}"#).unwrap();
        let b: serde_json::Value = serde_json::from_str(r#"{"c":{"x":1},"b":[1,2],"a":1}"#).unwrap();
        let c: serde_json::Value = serde_json::from_str(r#"{"a":1,"b":[2,1],"c":{"x":1}}"#).unwrap();
        assert!(same(&Json(a.clone()), &Json(b)));
        assert!(!same(&Json(a), &Json(c)));
    }

    #[test]
    fn the_same_instant_in_two_zones_is_equal() {
        let a = parse_ts("2024-03-01T10:00:00+02:00").unwrap();
        let b = parse_ts("2024-03-01 08:00:00").unwrap();
        let c = parse_ts("2024-03-01 08:00:00.5").unwrap();
        assert!(same(&Ts(a), &Ts(b)));
        assert!(!same(&Ts(a), &Ts(c)));
        assert!(parse_ts("not a date").is_none());
        assert_eq!(parse_ts("2024-03-01"), parse_ts("2024-03-01 00:00:00"));
    }

    #[test]
    fn numbers_sort_before_text_before_binary() {
        assert_eq!(cmp_vals(&n("99"), &Text("1".into())), Ordering::Less);
        assert_eq!(cmp_vals(&Text("z".into()), &Bytes(vec![0])), Ordering::Less);
        assert!(!same(&n("1"), &Text("1".into())));
    }

    #[test]
    fn keys_compare_column_by_column() {
        let a = [n("1"), Text("b".into())];
        let b = [n("1"), Text("c".into())];
        let c = [n("2"), Text("a".into())];
        assert_eq!(cmp_keys(&a, &b), Ordering::Less);
        assert_eq!(cmp_keys(&b, &c), Ordering::Less);
        assert_eq!(cmp_keys(&a, &a.clone()), Ordering::Equal);
    }

    #[test]
    fn key_values_go_out_in_their_wire_form() {
        assert_eq!(to_key(&n("42")), KeyVal::Int("42".into()));
        assert_eq!(to_key(&n("4.20")), KeyVal::Num("4.2".into()));
        assert_eq!(to_key(&Bytes(vec![1, 2])), KeyVal::Bytes("AQI=".into()));
        let ts = parse_ts("2024-03-01T10:00:00+02:00").unwrap();
        assert_eq!(to_key(&Ts(ts)), KeyVal::Ts("2024-03-01T08:00:00Z".into()));
    }
}
