use base64::Engine;
use std::str::FromStr;
use bson::{Bson, DateTime, Decimal128, Regex, Timestamp};
use bson::oid::ObjectId;
use super::{ParseError, Parser};

impl<'a> Parser<'a> {
    pub(super) fn parse_constructor(&mut self) -> Result<Bson, ParseError> {
        let name = self.parse_ident()?;
        self.expect(b'(', "(")?;
        match name.as_str() {
            "ObjectId" => {
                let hex = self.parse_string()?;
                let oid = ObjectId::parse_str(&hex)
                    .map_err(|_| self.err("ObjectId(): invalid 24-char hex id"))?;
                self.expect(b')', ")")?;
                Ok(Bson::ObjectId(oid))
            }
            "ISODate" | "Date" => {
                let s = self.parse_string()?;
                let dt = DateTime::parse_rfc3339_str(&s)
                    .map_err(|_| self.err("ISODate(): expected an RFC3339 date-time"))?;
                self.expect(b')', ")")?;
                Ok(Bson::DateTime(dt))
            }
            "NumberLong" => {
                let v = self.parse_i64_arg()?;
                self.expect(b')', ")")?;
                Ok(Bson::Int64(v))
            }
            "Int32" => {
                let v = self.parse_i64_arg()?;
                self.expect(b')', ")")?;
                Ok(Bson::Int32(v as i32))
            }
            "Double" => {
                let v = self.parse_f64_arg()?;
                self.expect(b')', ")")?;
                Ok(Bson::Double(v))
            }
            "NumberDecimal" | "Decimal128" => {
                let s = self.parse_string()?;
                let d = Decimal128::from_str(&s).map_err(|_| self.err("NumberDecimal(): invalid decimal"))?;
                self.expect(b')', ")")?;
                Ok(Bson::Decimal128(d))
            }
            "Binary" => {
                let base64 = self.parse_string()?;
                self.skip_ws();
                self.expect(b',', ",")?;
                let sub = self.parse_string()?;
                let subtype = u8::from_str_radix(&sub, 16)
                    .map_err(|_| self.err("Binary(): subtype must be hex, e.g. \"00\""))?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&base64)
                    .map_err(|_| self.err("Binary(): invalid base64 payload"))?;
                self.expect(b')', ")")?;
                Ok(Bson::Binary(bson::Binary { subtype: subtype.into(), bytes }))
            }
            "BinData" => {
                let sub = self.parse_i64_arg()? as u8;
                self.skip_ws();
                self.expect(b',', ",")?;
                let base64 = self.parse_string()?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&base64)
                    .map_err(|_| self.err("BinData(): invalid base64 payload"))?;
                self.expect(b')', ")")?;
                Ok(Bson::Binary(bson::Binary { subtype: (sub as u8).into(), bytes }))
            }
            "UUID" => {
                let s = self.parse_string()?;
                let raw = s.replace('-', "");
                let bytes = (0..raw.len() / 2)
                    .map(|i| u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16))
                    .collect::<Result<Vec<u8>, _>>()
                    .map_err(|_| self.err("UUID(): invalid uuid"))?;
                if bytes.len() != 16 {
                    return Err(self.err("UUID(): expected 16 bytes (32 hex chars)"));
                }
                self.expect(b')', ")")?;
                Ok(Bson::Binary(bson::Binary { subtype: bson::spec::BinarySubtype::Uuid, bytes }))
            }
            "RegExp" => {
                let pattern = self.parse_string()?;
                self.skip_ws();
                self.expect(b',', ",")?;
                let options = self.parse_string()?;
                self.expect(b')', ")")?;
                Ok(Bson::RegularExpression(Regex { pattern, options }))
            }
            "Timestamp" => {
                let t = self.parse_i64_arg()? as u32;
                self.skip_ws();
                self.expect(b',', ",")?;
                let i = self.parse_i64_arg()? as u32;
                self.expect(b')', ")")?;
                Ok(Bson::Timestamp(Timestamp { time: t, increment: i }))
            }
            "MinKey" => {
                self.expect(b')', ")")?;
                Ok(Bson::MinKey)
            }
            "MaxKey" => {
                self.expect(b')', ")")?;
                Ok(Bson::MaxKey)
            }
            "Symbol" => {
                let s = self.parse_string()?;
                self.expect(b')', ")")?;
                Ok(Bson::Symbol(s))
            }
            _ => Err(self.err(&format!("unknown BSON constructor `{name}()`"))),
        }
    }

    /// Argument for NumberLong/Int32/Timestamp: either a bare number or a
    /// quoted decimal string (to handle values beyond i64 text precision).
    fn parse_i64_arg(&mut self) -> Result<i64, ParseError> {
        self.skip_ws();
        if self.peek() == Some(b'"') {
            let s = self.parse_string()?;
            s.trim().parse::<i64>().map_err(|_| self.err("expected an integer"))
        } else {
            // Reuse number parsing but require an integer (no float).
            let start = self.i;
            self.parse_number()?;
            let text = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| self.err("bad number"))?;
            text.parse::<i64>().map_err(|_| self.err("expected an integer"))
        }
    }

    fn parse_f64_arg(&mut self) -> Result<f64, ParseError> {
        self.skip_ws();
        let start = self.i;
        self.parse_number()?;
        let text = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| self.err("bad number"))?;
        text.parse::<f64>().map_err(|_| self.err("expected a number"))
    }
}
