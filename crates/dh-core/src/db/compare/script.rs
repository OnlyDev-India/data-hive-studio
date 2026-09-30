//! The data sync script: statements that make the right side's rows match
//! the left's for the compared columns. It is only written, never run.

use std::io::{self, Write};

use super::canon::{ts_text, CanonVal};
use super::file::RowWriter;
use super::merge::Diff;
use super::ScanRow;
use crate::api::{DiffKind, TableRef};

/// The language a sync script for an engine is written in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptSyntax {
    Sqlite,
    Postgres,
    Mongosh,
}

fn quote_text(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// A value as a SQL literal the engine reads back as the same value. Values
/// with no portable literal form (timestamps, JSON, UUIDs) use the engine's
/// own output text, which it accepts as input.
pub fn sql_literal(v: &CanonVal, display: Option<&str>, syntax: ScriptSyntax) -> String {
    let pg = syntax == ScriptSyntax::Postgres;
    let shown = |fallback: String| quote_text(display.map_or(fallback.as_str(), |d| d));
    match v {
        CanonVal::Null => "NULL".into(),
        CanonVal::Num(d) => d.to_plain(),
        CanonVal::Text(s) => quote_text(s),
        CanonVal::Bool(b) if pg => if *b { "TRUE" } else { "FALSE" }.into(),
        CanonVal::Bool(b) => if *b { "1" } else { "0" }.into(),
        CanonVal::Bytes(b) if pg => format!("'\\x{}'::bytea", hex::encode(b)),
        CanonVal::Bytes(b) => format!("X'{}'", hex::encode(b)),
        CanonVal::Json(j) => shown(j.to_string()),
        CanonVal::Ts(n) => shown(ts_text(*n)),
        CanonVal::Uuid(u) => shown(uuid::Uuid::from_bytes(*u).to_string()),
        CanonVal::Oid(o) => shown(hex::encode(o)),
        CanonVal::Other(s) => shown(s.clone()),
    }
}

pub struct ScriptWriter {
    syntax: ScriptSyntax,
    left: String,
    right: TableRef,
    key_columns: Vec<String>,
    columns: Vec<String>,
}

impl ScriptWriter {
    pub fn new(syntax: ScriptSyntax, left: &TableRef, right: &TableRef, key_columns: &[String], columns: &[String]) -> Self {
        Self {
            syntax,
            left: side_name(left),
            right: right.clone(),
            key_columns: key_columns.to_vec(),
            columns: columns.to_vec(),
        }
    }

    fn table(&self) -> String {
        match &self.right.schema {
            Some(s) if self.syntax == ScriptSyntax::Postgres => {
                format!("{}.{}", quote_ident(s), quote_ident(&self.right.table))
            }
            _ => quote_ident(&self.right.table),
        }
    }

    fn key_lit(&self, row: &ScanRow, i: usize) -> String {
        sql_literal(&row.key[i], row.key_display.get(i).map(String::as_str), self.syntax)
    }

    fn val_lit(&self, row: &ScanRow, i: usize) -> String {
        sql_literal(&row.vals[i], row.display[i].as_deref(), self.syntax)
    }

    fn sql_where(&self, row: &ScanRow) -> String {
        let parts: Vec<String> = (0..self.key_columns.len())
            .map(|i| format!("{} = {}", quote_ident(&self.key_columns[i]), self.key_lit(row, i)))
            .collect();
        parts.join(" AND ")
    }

    fn sql_row(&self, w: &mut dyn Write, d: &Diff) -> io::Result<()> {
        let t = self.table();
        match (d.kind, &d.left, &d.right) {
            (DiffKind::LeftOnly, Some(l), _) => {
                let cols: Vec<String> = self.key_columns.iter().chain(&self.columns).map(|c| quote_ident(c)).collect();
                let vals: Vec<String> = (0..self.key_columns.len())
                    .map(|i| self.key_lit(l, i))
                    .chain((0..self.columns.len()).map(|i| self.val_lit(l, i)))
                    .collect();
                writeln!(w, "INSERT INTO {t} ({}) VALUES ({});", cols.join(", "), vals.join(", "))
            }
            (DiffKind::RightOnly, _, Some(r)) => writeln!(w, "DELETE FROM {t} WHERE {};", self.sql_where(r)),
            (DiffKind::Changed, Some(l), Some(r)) => {
                let set: Vec<String> = d
                    .changed
                    .iter()
                    .map(|&i| format!("{} = {}", quote_ident(&self.columns[i]), self.val_lit(l, i)))
                    .collect();
                writeln!(w, "UPDATE {t} SET {} WHERE {};", set.join(", "), self.sql_where(r))
            }
            _ => Ok(()),
        }
    }

    /// Mongo rows carry shell literals: key columns first, then the compared
    /// columns, `None` where the field is absent.
    fn lits<'r>(row: &'r ScanRow) -> &'r [Option<String>] {
        row.literals.as_deref().unwrap_or_default()
    }

    fn mongo_filter(&self, row: &ScanRow) -> String {
        let lits = Self::lits(row);
        let parts: Vec<String> = self
            .key_columns
            .iter()
            .enumerate()
            .map(|(i, k)| format!("{}: {}", json_key(k), lits.get(i).cloned().flatten().unwrap_or_else(|| "null".into())))
            .collect();
        format!("{{ {} }}", parts.join(", "))
    }

    fn mongo_row(&self, w: &mut dyn Write, d: &Diff) -> io::Result<()> {
        let nk = self.key_columns.len();
        match (d.kind, &d.left, &d.right) {
            (DiffKind::LeftOnly, Some(l), _) => {
                let lits = Self::lits(l);
                let fields: Vec<String> = self
                    .key_columns
                    .iter()
                    .chain(&self.columns)
                    .zip(lits)
                    .filter_map(|(c, v)| v.as_ref().map(|v| format!("{}: {v}", json_key(c))))
                    .collect();
                writeln!(w, "coll.insertOne({{ {} }});", fields.join(", "))
            }
            (DiffKind::RightOnly, _, Some(r)) => writeln!(w, "coll.deleteOne({});", self.mongo_filter(r)),
            (DiffKind::Changed, Some(l), Some(r)) => {
                let lits = Self::lits(l);
                let (mut set, mut unset) = (Vec::new(), Vec::new());
                for &i in &d.changed {
                    let name = json_key(&self.columns[i]);
                    match lits.get(nk + i).cloned().flatten() {
                        Some(v) => set.push(format!("{name}: {v}")),
                        None => unset.push(format!("{name}: \"\"")),
                    }
                }
                let mut ops = Vec::new();
                if !set.is_empty() {
                    ops.push(format!("$set: {{ {} }}", set.join(", ")));
                }
                if !unset.is_empty() {
                    ops.push(format!("$unset: {{ {} }}", unset.join(", ")));
                }
                writeln!(w, "coll.updateOne({}, {{ {} }});", self.mongo_filter(r), ops.join(", "))
            }
            _ => Ok(()),
        }
    }
}

fn json_key(k: &str) -> String {
    serde_json::to_string(k).unwrap_or_else(|_| format!("\"{k}\""))
}

fn side_name(r: &TableRef) -> String {
    [r.database.as_deref(), r.schema.as_deref(), Some(r.table.as_str())]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(".")
}

impl RowWriter for ScriptWriter {
    fn begin(&mut self, w: &mut dyn Write) -> io::Result<()> {
        let c = if self.syntax == ScriptSyntax::Mongosh { "//" } else { "--" };
        writeln!(w, "{c} Makes {} match {} for the compared columns.", side_name(&self.right), self.left)?;
        writeln!(w, "{c} Key: {}. Columns: {}.", self.key_columns.join(", "), self.columns.join(", "))?;
        writeln!(w, "{c} Written by DH Studio. Read it before you run it against the right side.")?;
        writeln!(w)?;
        if self.syntax == ScriptSyntax::Mongosh {
            let db = match &self.right.database {
                Some(d) => format!("db.getSiblingDB({})", json_key(d)),
                None => "db".into(),
            };
            writeln!(w, "const coll = {db}.getCollection({});", json_key(&self.right.table))
        } else {
            writeln!(w, "BEGIN;")
        }
    }

    fn row(&mut self, w: &mut dyn Write, d: Diff) -> io::Result<()> {
        if self.syntax == ScriptSyntax::Mongosh {
            self.mongo_row(w, &d)
        } else {
            self.sql_row(w, &d)
        }
    }

    fn end(&mut self, w: &mut dyn Write) -> io::Result<()> {
        if self.syntax != ScriptSyntax::Mongosh {
            writeln!(w, "COMMIT;")?;
        }
        Ok(())
    }
}

/// Shell literal text for a BSON value, lossless in mongosh. Values the
/// renderer can't write as mongosh reads them go through `EJSON.parse`.
pub fn mongosh_literal(v: &bson::Bson) -> String {
    if shell_safe(v) {
        crate::db::mongo_json::render_bson(v)
    } else {
        let ejson = v.clone().into_canonical_extjson().to_string();
        format!("EJSON.parse({})", json_key(&ejson))
    }
}

fn shell_safe(v: &bson::Bson) -> bool {
    use bson::Bson::*;
    const SAFE_INT: i64 = 1 << 53;
    match v {
        Double(f) => f.is_finite(),
        Int64(n) => n.abs() < SAFE_INT,
        DateTime(t) => t.try_to_rfc3339_string().is_ok(),
        Array(a) => a.iter().all(shell_safe),
        Document(d) => d.values().all(shell_safe),
        String(_) | Boolean(_) | Int32(_) | Decimal128(_) | Null | Undefined | ObjectId(_) | Timestamp(_)
        | MinKey | MaxKey => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::compare::Dec;

    fn row(key: Vec<CanonVal>, vals: Vec<CanonVal>, display: Vec<Option<&str>>) -> ScanRow {
        ScanRow {
            key_display: key.iter().map(|_| "1".to_string()).collect(),
            key,
            vals,
            display: display.into_iter().map(|d| d.map(str::to_string)).collect(),
            literals: None,
        }
    }

    fn writer(syntax: ScriptSyntax) -> ScriptWriter {
        let side = |t: &str| TableRef {
            conn_id: "c".into(),
            conn_key: String::new(),
            database: None,
            schema: Some("public".into()),
            table: t.into(),
        };
        ScriptWriter::new(syntax, &side("a"), &side("b"), &["id".into()], &["name".into(), "ok".into()])
    }

    fn render(w: &mut ScriptWriter, d: Diff) -> String {
        let mut out = Vec::new();
        w.row(&mut out, d).unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn literals_quote_text_and_follow_the_engine() {
        let pg = ScriptSyntax::Postgres;
        assert_eq!(sql_literal(&CanonVal::Text("it's".into()), None, pg), "'it''s'");
        assert_eq!(sql_literal(&CanonVal::Num(Dec::parse("1.50").unwrap()), None, pg), "1.5");
        assert_eq!(sql_literal(&CanonVal::Bool(true), None, pg), "TRUE");
        assert_eq!(sql_literal(&CanonVal::Bool(true), None, ScriptSyntax::Sqlite), "1");
        assert_eq!(sql_literal(&CanonVal::Bytes(vec![1, 255]), None, pg), "'\\x01ff'::bytea");
        assert_eq!(sql_literal(&CanonVal::Bytes(vec![1, 255]), None, ScriptSyntax::Sqlite), "X'01ff'");
        assert_eq!(sql_literal(&CanonVal::Ts(0), Some("2024-01-01 00:00:00"), pg), "'2024-01-01 00:00:00'");
        assert_eq!(sql_literal(&CanonVal::Null, None, pg), "NULL");
    }

    #[test]
    fn sql_statements_change_the_right_toward_the_left() {
        let mut w = writer(ScriptSyntax::Postgres);
        let one = || vec![CanonVal::Num(Dec::from_i64(1))];
        let l = row(one(), vec![CanonVal::Text("x".into()), CanonVal::Bool(true)], vec![Some("x"), Some("true")]);
        let r = row(one(), vec![CanonVal::Text("y".into()), CanonVal::Bool(true)], vec![Some("y"), Some("true")]);
        let ins = render(&mut w, Diff { kind: DiffKind::LeftOnly, left: Some(l), right: None, changed: vec![] });
        assert_eq!(ins, "INSERT INTO \"public\".\"b\" (\"id\", \"name\", \"ok\") VALUES (1, 'x', TRUE);\n");
        let l = row(one(), vec![CanonVal::Text("x".into()), CanonVal::Bool(true)], vec![Some("x"), Some("true")]);
        let upd = render(&mut w, Diff { kind: DiffKind::Changed, left: Some(l), right: Some(r), changed: vec![0] });
        assert_eq!(upd, "UPDATE \"public\".\"b\" SET \"name\" = 'x' WHERE \"id\" = 1;\n");
        let r = row(one(), vec![CanonVal::Null, CanonVal::Null], vec![None, None]);
        let del = render(&mut w, Diff { kind: DiffKind::RightOnly, left: None, right: Some(r), changed: vec![] });
        assert_eq!(del, "DELETE FROM \"public\".\"b\" WHERE \"id\" = 1;\n");
    }

    #[test]
    fn mongo_updates_set_present_fields_and_unset_absent_ones() {
        let mut w = writer(ScriptSyntax::Mongosh);
        let mut l = row(vec![CanonVal::Num(Dec::from_i64(1))], vec![CanonVal::Null, CanonVal::Null], vec![None, None]);
        l.literals = Some(vec![Some("Int32(1)".into()), None, Some("true".into())]);
        let mut r = row(vec![CanonVal::Num(Dec::from_i64(1))], vec![CanonVal::Null, CanonVal::Null], vec![None, None]);
        r.literals = Some(vec![Some("Int32(1)".into()), Some("\"y\"".into()), Some("false".into())]);
        let upd = render(&mut w, Diff { kind: DiffKind::Changed, left: Some(l), right: Some(r), changed: vec![0, 1] });
        assert_eq!(upd, "coll.updateOne({ \"id\": Int32(1) }, { $set: { \"ok\": true }, $unset: { \"name\": \"\" } });\n");
    }

    #[test]
    fn unsafe_bson_goes_through_ejson() {
        assert_eq!(mongosh_literal(&bson::Bson::Int32(5)), "Int32(5)");
        let big = mongosh_literal(&bson::Bson::Int64(9_007_199_254_740_993));
        assert_eq!(big, r#"EJSON.parse("{\"$numberLong\":\"9007199254740993\"}")"#);
        let bin = bson::Bson::Binary(bson::Binary { subtype: bson::spec::BinarySubtype::Generic, bytes: vec![1] });
        assert!(mongosh_literal(&bin).starts_with("EJSON.parse("));
    }
}
