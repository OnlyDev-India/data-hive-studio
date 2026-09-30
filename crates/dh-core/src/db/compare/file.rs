//! Writes a whole diff to a file, streaming: every difference as CSV or
//! JSON, or the data sync script. Nothing is held past one row.

use std::io::{self, Write};
use std::time::{Duration, Instant};

use super::merge::{Collector, Diff, Flow, Progress};
use super::script::{ScriptSyntax, ScriptWriter};
use super::ScanRow;
use crate::api::{CompareDataRequest, CompareFileKind, DiffCounts, DiffKind, RowsRead};
use crate::db::{DbError, DbResult};

/// One output format.
pub trait RowWriter: Send {
    fn begin(&mut self, w: &mut dyn Write) -> io::Result<()>;
    fn row(&mut self, w: &mut dyn Write, d: Diff) -> io::Result<()>;
    fn end(&mut self, w: &mut dyn Write) -> io::Result<()>;
}

pub fn write_failed(e: io::Error) -> DbError {
    DbError::InvalidOperation(format!("Could not write the file: {e}"))
}

fn kind_name(k: DiffKind) -> &'static str {
    match k {
        DiffKind::LeftOnly => "left_only",
        DiffKind::RightOnly => "right_only",
        DiffKind::Changed => "changed",
    }
}

fn key_display(d: &Diff) -> &[String] {
    d.left.as_ref().or(d.right.as_ref()).map_or(&[], |r| &r.key_display)
}

fn shown(row: Option<&ScanRow>, i: usize) -> Option<&str> {
    row.and_then(|r| r.display.get(i)).and_then(|v| v.as_deref())
}

struct Csv {
    key_columns: Vec<String>,
    columns: Vec<String>,
}

/// NULL is an empty cell; an empty string is quoted, so the two differ.
fn csv_cell(v: Option<&str>) -> String {
    match v {
        None => String::new(),
        Some(s) if s.is_empty() || s.contains([',', '"', '\n', '\r']) || s.trim() != s => {
            format!("\"{}\"", s.replace('"', "\"\""))
        }
        Some(s) => s.to_string(),
    }
}

impl RowWriter for Csv {
    fn begin(&mut self, w: &mut dyn Write) -> io::Result<()> {
        let mut head = vec!["difference".to_string()];
        head.extend(self.key_columns.iter().cloned());
        for c in &self.columns {
            head.push(format!("{c} (left)"));
            head.push(format!("{c} (right)"));
        }
        head.push("changed columns".into());
        let cells: Vec<String> = head.iter().map(|h| csv_cell(Some(h))).collect();
        writeln!(w, "{}", cells.join(","))
    }

    fn row(&mut self, w: &mut dyn Write, d: Diff) -> io::Result<()> {
        let mut cells = vec![kind_name(d.kind).to_string()];
        cells.extend(key_display(&d).iter().map(|k| csv_cell(Some(k))));
        for i in 0..self.columns.len() {
            cells.push(csv_cell(shown(d.left.as_ref(), i)));
            cells.push(csv_cell(shown(d.right.as_ref(), i)));
        }
        let changed: Vec<&str> = d.changed.iter().map(|&i| self.columns[i].as_str()).collect();
        cells.push(if changed.is_empty() { String::new() } else { csv_cell(Some(&changed.join("; "))) });
        writeln!(w, "{}", cells.join(","))
    }

    fn end(&mut self, _w: &mut dyn Write) -> io::Result<()> {
        Ok(())
    }
}

struct Json {
    key_columns: Vec<String>,
    columns: Vec<String>,
    first: bool,
}

fn js(v: Option<&str>) -> String {
    v.map_or_else(|| "null".into(), |s| serde_json::to_string(s).unwrap_or_else(|_| "null".into()))
}

impl Json {
    /// An object in column order (serde_json's map would sort the keys).
    fn object<'a>(names: &[String], vals: impl Iterator<Item = Option<&'a str>>) -> String {
        let fields: Vec<String> = names.iter().zip(vals).map(|(n, v)| format!("{}: {}", js(Some(n)), js(v))).collect();
        format!("{{{}}}", fields.join(", "))
    }
}

impl RowWriter for Json {
    fn begin(&mut self, w: &mut dyn Write) -> io::Result<()> {
        write!(w, "[")
    }

    fn row(&mut self, w: &mut dyn Write, d: Diff) -> io::Result<()> {
        let sep = if std::mem::take(&mut self.first) { "\n  " } else { ",\n  " };
        let mut fields = vec![
            format!("\"difference\": {}", js(Some(kind_name(d.kind)))),
            format!("\"key\": {}", Self::object(&self.key_columns, key_display(&d).iter().map(|k| Some(k.as_str())))),
        ];
        let n = self.columns.len();
        if let Some(l) = &d.left {
            fields.push(format!("\"left\": {}", Self::object(&self.columns, (0..n).map(|i| shown(Some(l), i)))));
        }
        if let Some(r) = &d.right {
            fields.push(format!("\"right\": {}", Self::object(&self.columns, (0..n).map(|i| shown(Some(r), i)))));
        }
        if d.kind == DiffKind::Changed {
            let names: Vec<String> = d.changed.iter().map(|&i| js(Some(&self.columns[i]))).collect();
            fields.push(format!("\"changed\": [{}]", names.join(", ")));
        }
        write!(w, "{sep}{{{}}}", fields.join(", "))
    }

    fn end(&mut self, w: &mut dyn Write) -> io::Result<()> {
        writeln!(w, "{}]", if self.first { "" } else { "\n" })
    }
}

pub fn row_writer(kind: CompareFileKind, req: &CompareDataRequest, syntax: ScriptSyntax) -> Box<dyn RowWriter> {
    let (key_columns, columns) = (req.key_columns.clone(), req.columns.clone());
    match kind {
        CompareFileKind::Csv => Box::new(Csv { key_columns, columns }),
        CompareFileKind::Json => Box::new(Json { key_columns, columns, first: true }),
        CompareFileKind::SyncScript => {
            Box::new(ScriptWriter::new(syntax, &req.left, &req.right, &req.key_columns, &req.columns))
        }
    }
}

const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// Sends every difference to a file format, with no page limit.
pub struct FileCollector<'a> {
    pub w: &'a mut (dyn Write + Send),
    pub fmt: Box<dyn RowWriter>,
    pub written: u64,
    last_progress: Instant,
}

impl<'a> FileCollector<'a> {
    pub fn new(w: &'a mut (dyn Write + Send), fmt: Box<dyn RowWriter>) -> DbResult<Self> {
        let mut c = Self { w, fmt, written: 0, last_progress: Instant::now() };
        c.fmt.begin(c.w).map_err(write_failed)?;
        Ok(c)
    }
}

impl Collector for FileCollector<'_> {
    fn diff(&mut self, d: Diff) -> DbResult<Flow> {
        self.fmt.row(self.w, d).map_err(write_failed)?;
        self.written += 1;
        Ok(Flow::Go)
    }

    fn tick(&mut self, counts: DiffCounts, rows_read: RowsRead, progress: &Progress) -> DbResult<()> {
        if self.last_progress.elapsed() >= PROGRESS_EVERY {
            self.last_progress = Instant::now();
            progress.set(counts, rows_read);
        }
        Ok(())
    }

    fn finish(&mut self) -> DbResult<()> {
        self.fmt.end(self.w).map_err(write_failed)?;
        self.w.flush().map_err(write_failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::compare::{CanonVal, Dec};

    fn row(key: &str, vals: &[Option<&str>]) -> ScanRow {
        ScanRow {
            key: vec![CanonVal::Num(Dec::parse(key).unwrap())],
            key_display: vec![key.into()],
            vals: vals.iter().map(|_| CanonVal::Null).collect(),
            display: vals.iter().map(|v| v.map(str::to_string)).collect(),
            literals: None,
        }
    }

    fn write(fmt: &mut dyn RowWriter, diffs: Vec<Diff>) -> String {
        let mut out = Vec::new();
        fmt.begin(&mut out).unwrap();
        for d in diffs {
            fmt.row(&mut out, d).unwrap();
        }
        fmt.end(&mut out).unwrap();
        String::from_utf8(out).unwrap()
    }

    fn diffs() -> Vec<Diff> {
        vec![
            Diff { kind: DiffKind::Changed, left: Some(row("1", &[Some("a,b"), None])), right: Some(row("1", &[Some(""), None])), changed: vec![0] },
            Diff { kind: DiffKind::RightOnly, left: None, right: Some(row("2", &[Some("x"), Some("y")])), changed: vec![] },
        ]
    }

    fn cols() -> (Vec<String>, Vec<String>) {
        (vec!["id".into()], vec!["name".into(), "note".into()])
    }

    #[test]
    fn csv_keeps_null_and_empty_apart() {
        let (key_columns, columns) = cols();
        let out = write(&mut Csv { key_columns, columns }, diffs());
        assert_eq!(
            out,
            "difference,id,name (left),name (right),note (left),note (right),changed columns\n\
             changed,1,\"a,b\",\"\",,,name\n\
             right_only,2,,x,,y,\n"
        );
    }

    #[test]
    fn json_is_an_array_in_column_order() {
        let (key_columns, columns) = cols();
        let out = write(&mut Json { key_columns, columns, first: true }, diffs());
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 2);
        assert_eq!(v[0]["left"]["note"], serde_json::Value::Null);
        assert_eq!(v[0]["changed"][0], "name");
        assert!(v[1].get("left").is_none());
        assert!(out.contains(r#""left": {"name": "a,b", "note": null}"#));
    }

    #[test]
    fn an_empty_diff_is_an_empty_json_array() {
        let (key_columns, columns) = cols();
        let out = write(&mut Json { key_columns, columns, first: true }, vec![]);
        assert_eq!(serde_json::from_str::<serde_json::Value>(&out).unwrap(), serde_json::json!([]));
    }
}
