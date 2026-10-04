//! The comment pass of `parse`: each card's `// @title` and note comments
//! move into its stage document, and each `// @disabled` card is put back
//! in as a stage, so one strict parse reads the whole Save format.

use crate::db::mongo_json::{parse, quote_bare_keys};
use super::compose::json_string;
use super::parse::{blank_comments, close_of};

/// A card's title, note and disabled state, carried inside its stage
/// document between the comment pass and the walk.
pub(super) const META: &str = "__dh_card";

#[derive(Default)]
struct Marks {
    title: Option<String>,
    note: Vec<String>,
}

impl Marks {
    fn is_empty(&self) -> bool {
        self.title.is_none() && self.note.is_empty()
    }

    fn json(&self, disabled: bool, raw: Option<&str>) -> String {
        let mut fields = Vec::new();
        if let Some(t) = &self.title {
            fields.push(format!("\"title\": {}", json_string(t)));
        }
        if !self.note.is_empty() {
            fields.push(format!("\"note\": {}", json_string(self.note.join("\n").trim_matches('\n'))));
        }
        if disabled {
            fields.push("\"disabled\": true".into());
        }
        if let Some(r) = raw {
            fields.push(format!("\"raw\": {}", json_string(r)));
        }
        format!("\"{META}\": {{ {} }}", fields.join(", "))
    }
}

/// `s` (an array's text) with its comments gone, each card's marks moved
/// into its stage document under `META`, and each `// @disabled` card put
/// back in as a stage.
pub(super) fn with_marks(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = String::with_capacity(s.len() + 64);
    let mut marks = Marks::default();
    // The last significant character written, to tell where an array
    // element starts; and whether a card put back in needs a comma next.
    let mut last: Option<char> = None;
    let mut need_comma = false;
    let mut i = 0;
    while i < s.len() {
        let c = b[i];
        if c == b'"' || c == b'\'' {
            if need_comma {
                out.push(',');
                need_comma = false;
            }
            let end = string_end(b, i);
            out.push_str(&s[i..end]);
            last = Some(c as char);
            marks = Marks::default();
            i = end;
            continue;
        }
        if s[i..].starts_with("//") {
            let line_end = s[i..].find('\n').map_or(s.len(), |n| i + n);
            let content = s[i + 2..line_end].strip_prefix(' ').unwrap_or(&s[i + 2..line_end]).trim_end();
            i = line_end;
            if let Some(title) = content.trim().strip_prefix("@title") {
                marks.title = Some(title.trim().to_string()).filter(|t| !t.is_empty());
            } else if content.trim() == "@disabled" {
                let (card, next) = disabled_card(s, i);
                i = next;
                if !matches!(last, None | Some('[') | Some(',')) {
                    out.push(',');
                }
                out.push_str(&with_meta(&card, &marks));
                marks = Marks::default();
                last = Some('}');
                need_comma = true;
            } else {
                marks.note.push(content.to_string());
            }
            continue;
        }
        if s[i..].starts_with("/*") {
            let stop = s[i + 2..].find("*/").map_or(s.len(), |n| i + 2 + n);
            marks.note.extend(s[i + 2..stop].lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()));
            i = (stop + 2).min(s.len());
            continue;
        }
        if (c as char).is_whitespace() {
            out.push(c as char);
            i += 1;
            continue;
        }
        let ch = s[i..].chars().next().unwrap_or(' ');
        let starts_element = ch == '{' && (need_comma || matches!(last, Some('[') | Some(',')));
        if need_comma && ch != ']' && ch != ',' {
            out.push(',');
        }
        need_comma = false;
        out.push(ch);
        if starts_element && !marks.is_empty() {
            out.push_str(&marks.json(false, None));
            if !next_is(s, i + 1, b'}') {
                out.push(',');
            }
        }
        marks = Marks::default();
        last = Some(ch);
        i += ch.len_utf8();
    }
    out
}

/// The byte after the string that opens at `i`.
fn string_end(b: &[u8], i: usize) -> usize {
    let q = b[i];
    let mut j = i + 1;
    while j < b.len() {
        if b[j] == b'\\' {
            j += 2;
            continue;
        }
        if b[j] == q {
            return j + 1;
        }
        j += 1;
    }
    b.len()
}

/// Whether the next significant byte from `i` is `want`, comments skipped.
fn next_is(s: &str, i: usize, want: u8) -> bool {
    blank_comments(&s[i..]).trim_start().as_bytes().first() == Some(&want)
}

/// The commented out lines after `// @disabled` at `from`, uncommented, up
/// to where the card's braces close; and the byte after them.
fn disabled_card(s: &str, from: usize) -> (String, usize) {
    let mut text = String::new();
    let mut at = from;
    loop {
        let line_start = at + s[at..].len() - s[at..].trim_start_matches(['\n', '\r']).len();
        let line_end = s[line_start..].find('\n').map_or(s.len(), |n| line_start + n);
        let Some(body) = s[line_start..line_end].trim_start().strip_prefix("//") else { break };
        text.push_str(body.strip_prefix(' ').unwrap_or(body));
        text.push('\n');
        at = line_end;
        let code = blank_comments(&text);
        let open = code.find('{');
        if open.is_some_and(|o| close_of(&code, o).is_some()) || line_end == s.len() {
            break;
        }
    }
    (text.trim_end().to_string(), at)
}

/// A disabled card's text as a stage document carrying its marks; when it
/// does not parse, as a document holding the text for the walk to split.
fn with_meta(card: &str, marks: &Marks) -> String {
    let inner = with_marks(card);
    let open = inner.find('{');
    let ok = open.is_some() && parse(&quote_bare_keys(&inner)).is_ok();
    match open {
        Some(o) if ok => {
            let rest = &inner[o + 1..];
            let sep = if rest.trim_start().starts_with('}') { "" } else { "," };
            format!("{}{{{}{sep}{rest}", &inner[..o], marks.json(true, None))
        }
        _ => format!("{{{}}}", marks.json(true, Some(card))),
    }
}

#[cfg(test)]
mod tests {
    use crate::api::ParsedPipeline;
    use crate::db::mongodb::pipeline::parse_pipeline;

    fn cards(text: &str) -> ParsedPipeline {
        parse_pipeline(text).unwrap_or_else(|e| panic!("{e}\n{text}"))
    }

    fn ops(p: &ParsedPipeline) -> Vec<(&str, &str, bool)> {
        p.stages.iter().map(|s| (s.op.as_str(), s.body.as_str(), s.enabled)).collect()
    }

    #[test]
    fn a_block_comment_becomes_the_next_cards_note() {
        let p = cards("[\n  /* why\n     and how */\n  { $match: {} }\n]");
        assert_eq!(p.stages[0].note.as_deref(), Some("why\nand how"));
    }

    #[test]
    fn an_empty_title_mark_sets_no_title_and_no_note() {
        let p = cards("[\n  // @title\n  { $limit: 1 }\n]");
        assert_eq!(p.stages[0].title, None);
        assert_eq!(p.stages[0].note, None);
    }

    #[test]
    fn slashes_inside_a_string_are_not_a_comment() {
        let p = cards(r#"[{ $match: { url: "http://x.io//y" } }]"#);
        assert_eq!(ops(&p), [("$match", "{ url: \"http://x.io//y\" }", true)]);
        assert_eq!(p.stages[0].note, None);
    }

    #[test]
    fn a_disabled_card_over_several_lines_reads_with_its_title() {
        let p = cards("[\n  // @title Off\n  // @disabled\n  // {\n  //   $match: { a: 1 }\n  // }\n  { $limit: 1 }\n]");
        assert_eq!(ops(&p), [("$match", "{ a: 1 }", false), ("$limit", "1", true)]);
        assert_eq!(p.stages[0].title.as_deref(), Some("Off"));
        assert_eq!(p.stages[1].title, None);
    }

    #[test]
    fn a_disabled_card_reads_between_cards_and_last() {
        let between = cards("[{ $skip: 1 },\n  // @disabled\n  // { $sort: { n: 1 } }\n  { $limit: 1 }\n]");
        assert_eq!(
            ops(&between),
            [("$skip", "1", true), ("$sort", "{ n: 1 }", false), ("$limit", "1", true)]
        );
        let last = cards("[{ $skip: 1 }\n  // @disabled\n  // { $sort: { n: 1 } }\n]");
        assert_eq!(ops(&last), [("$skip", "1", true), ("$sort", "{ n: 1 }", false)]);
    }

    #[test]
    fn a_note_stays_on_its_own_card() {
        let p = cards("[\n  // first\n  { $skip: 1 },\n  { $limit: 1 }\n]");
        assert_eq!(p.stages[0].note.as_deref(), Some("first"));
        assert_eq!(p.stages[1].note, None);
    }
}
