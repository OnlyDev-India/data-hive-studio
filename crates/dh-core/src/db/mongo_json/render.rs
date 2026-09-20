use base64::Engine;
use bson::{Bson, Document};

/// Render a BSON document to MQL extended JSON text.
pub fn render(doc: &Document) -> String {
    let mut out = String::new();
    render_document(doc, &mut out, 0);
    out
}

fn render_document(doc: &Document, out: &mut String, depth: usize) {
    out.push('{');
    let mut first = true;
    for (k, v) in doc.iter() {
        if !first {
            out.push(',');
        }
        push_indent(out, depth + 1);
        out.push_str(&json_encode(k));
        out.push_str(": ");
        render_value(v, out, depth + 1);
        first = false;
    }
    if !first {
        out.push('\n');
        push_indent(out, depth);
    }
    out.push('}');
}

fn render_array(arr: &[Bson], out: &mut String, depth: usize) {
    out.push('[');
    let mut first = true;
    for v in arr {
        if !first {
            out.push(',');
        }
        push_indent(out, depth + 1);
        render_value(v, out, depth + 1);
        first = false;
    }
    if !first {
        out.push('\n');
        push_indent(out, depth);
    }
    out.push(']');
}

fn render_value(v: &Bson, out: &mut String, depth: usize) {
    use bson::Bson::*;
    match v {
        Double(f) => out.push_str(&format!("Double({f})")),
        String(s) => out.push_str(&json_encode(s)),
        Array(a) => render_array(a, out, depth),
        Document(d) => render_document(d, out, depth),
        Boolean(b) => out.push_str(if *b { "true" } else { "false" }),
        Int32(i) => out.push_str(&format!("Int32({i})")),
        Int64(i) => out.push_str(&format!("NumberLong({i})")),
        Decimal128(d) => out.push_str(&format!("NumberDecimal(\"{}\")", d.to_string())),
        DateTime(dt) => out.push_str(&format!("ISODate(\"{}\")", dt.try_to_rfc3339_string().unwrap_or_default())),
        Null | Undefined => out.push_str("null"),
        ObjectId(oid) => out.push_str(&format!("ObjectId(\"{}\")", oid.to_hex())),
        Binary(bin) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bin.bytes);
            let sub = format!("{:02X}", u8::from(bin.subtype));
            out.push_str(&format!("Binary(\"{b64}\", \"{sub}\")"));
        }
        RegularExpression(rx) => {
            out.push('/');
            out.push_str(&rx.pattern);
            out.push('/');
            out.push_str(&rx.options);
        }
        Timestamp(ts) => out.push_str(&format!("Timestamp({}, {})", ts.time, ts.increment)),
        MinKey => out.push_str("MinKey()"),
        MaxKey => out.push_str("MaxKey()"),
        Symbol(s) => out.push_str(&format!("Symbol(\"{}\")", json_encode(s))),
        other => out.push_str(&json_encode(&other.to_string())),
    }
}

fn push_indent(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str("  ");
    }
}

/// JSON-encode a string value (quoted, with escapes).
fn json_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
