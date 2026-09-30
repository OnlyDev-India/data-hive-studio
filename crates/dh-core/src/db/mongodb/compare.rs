//! One side of a collection data diff: a `find` sorted on the key. A plain
//! find cannot write, and it has no snapshot across a long cursor.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use bson::spec::BinarySubtype;
use bson::{doc, Binary, Bson, Document};
use futures_util::TryStreamExt;

use super::cancel::{mongo_canceller, mongo_err};
use super::filter::json_cell_string;
use super::stream::CURSOR_BATCH;
use super::MongoAdapter;
use crate::api::KeyVal;
use crate::db::compare::{mongosh_literal, CanonVal, Dec};
use crate::db::stream::BATCH_ROWS;
use crate::db::{mongo_json, DbError, DbResult, RunHandle, ScanOut, ScanRow, ScanSpec};

impl MongoAdapter {
    pub(super) async fn compare_scan(&self, spec: &ScanSpec<'_>, run: &RunHandle, out: &ScanOut) -> DbResult<()> {
        let database = spec.database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let filter = scan_filter(spec)?;
        let sort: Document = spec.key_columns.iter().map(|k| (k.clone(), Bson::Int32(1))).collect();
        let mut projection: Document =
            spec.key_columns.iter().chain(spec.columns).map(|c| (c.clone(), Bson::Int32(1))).collect();
        if !projection.contains_key("_id") {
            projection.insert("_id", 0);
        }

        let canceller = mongo_canceller(self.client.clone(), run.run_id().to_string());
        let Some(id) = run.add_canceller(canceller).await else { return Err(DbError::Cancelled) };
        let res = async {
            let cursor = self
                .client
                .database(&database)
                .collection::<Document>(spec.table)
                .find(filter)
                .sort(sort)
                .projection(projection)
                .allow_disk_use(true)
                .batch_size(CURSOR_BATCH)
                .comment(Bson::String(run.run_id().to_string()))
                .await
                .map_err(|e| mongo_err(e, Some(run)))?;
            read_docs(cursor, spec, run, out).await
        }
        .await;
        run.remove_canceller(id).await;
        res
    }
}

/// The filter document, narrowed to keys after the resume point.
fn scan_filter(spec: &ScanSpec<'_>) -> DbResult<Document> {
    let filter = match spec.filter {
        Some(f) => mongo_json::parse(f)
            .map_err(|e| DbError::InvalidOperation(format!("the filter is not a valid document: {e}")))?,
        None => Document::new(),
    };
    let Some(after) = spec.after_key else { return Ok(filter) };
    let resume = resume_filter(spec.key_columns, after)?;
    Ok(if filter.is_empty() { resume } else { doc! { "$and": [filter, resume] } })
}

/// Keys strictly after `after` in sort order: `a > x`, or `a = x and b > y`,
/// and so on.
fn resume_filter(keys: &[String], after: &[KeyVal]) -> DbResult<Document> {
    let vals: Vec<Bson> = after.iter().map(key_bson).collect::<DbResult<_>>()?;
    let branches: Vec<Bson> = (0..keys.len())
        .map(|i| {
            let mut branch: Document = keys[..i].iter().cloned().zip(vals[..i].iter().cloned()).collect();
            branch.insert(keys[i].clone(), doc! { "$gt": vals[i].clone() });
            Bson::Document(branch)
        })
        .collect();
    Ok(doc! { "$or": branches })
}

fn key_bson(k: &KeyVal) -> DbResult<Bson> {
    let bad = || DbError::InvalidOperation(format!("the page key {k:?} cannot be read back"));
    Ok(match k {
        KeyVal::Int(s) => match s.parse::<i64>() {
            Ok(n) => Bson::Int64(n),
            Err(_) => Bson::Double(s.parse().map_err(|_| bad())?),
        },
        KeyVal::Num(s) => Bson::Double(s.parse().map_err(|_| bad())?),
        KeyVal::Text(s) => Bson::String(s.clone()),
        KeyVal::Bool(b) => Bson::Boolean(*b),
        KeyVal::Oid(s) => Bson::ObjectId(bson::oid::ObjectId::parse_str(s).map_err(|_| bad())?),
        KeyVal::Ts(s) => Bson::DateTime(bson::DateTime::parse_rfc3339_str(s).map_err(|_| bad())?),
        KeyVal::Bytes(s) => Bson::Binary(Binary {
            subtype: BinarySubtype::Generic,
            bytes: B64.decode(s).map_err(|_| bad())?,
        }),
        KeyVal::Uuid(s) => Bson::Binary(Binary {
            subtype: BinarySubtype::Uuid,
            bytes: uuid::Uuid::parse_str(s).map_err(|_| bad())?.as_bytes().to_vec(),
        }),
        KeyVal::Ejson(s) => {
            let v: serde_json::Value = serde_json::from_str(s).map_err(|_| bad())?;
            Bson::try_from(v).map_err(|_| bad())?
        }
    })
}

async fn read_docs<S>(mut cursor: S, spec: &ScanSpec<'_>, run: &RunHandle, out: &ScanOut) -> DbResult<()>
where
    S: futures_util::Stream<Item = Result<Document, mongodb::error::Error>> + Unpin,
{
    let mut batch = Vec::with_capacity(BATCH_ROWS);
    while let Some(d) = cursor.try_next().await.map_err(|e| mongo_err(e, Some(run)))? {
        batch.push(decode(&d, spec));
        if batch.len() >= BATCH_ROWS && !out.send(std::mem::take(&mut batch)).await {
            // Dropping the cursor kills it on the server.
            return Ok(());
        }
    }
    if !batch.is_empty() {
        out.send(batch).await;
    }
    Ok(())
}

fn decode(d: &Document, spec: &ScanSpec<'_>) -> ScanRow {
    let shown = |v: Option<&Bson>| v.and_then(|v| json_cell_string(&MongoAdapter::bson_to_json(v.clone())));
    ScanRow {
        key: spec.key_columns.iter().map(|k| d.get(k).map_or(CanonVal::Null, canon)).collect(),
        key_display: spec
            .key_columns
            .iter()
            .map(|k| shown(d.get(k)).unwrap_or_else(|| "NULL".into()))
            .collect(),
        vals: spec.columns.iter().map(|c| d.get(c).map_or(CanonVal::Null, canon)).collect(),
        display: spec.columns.iter().map(|c| shown(d.get(c))).collect(),
        literals: spec.literals.then(|| {
            spec.key_columns.iter().chain(spec.columns).map(|c| d.get(c).map(mongosh_literal)).collect()
        }),
    }
}

/// A missing field reads as NULL, like an explicit null.
fn canon(v: &Bson) -> CanonVal {
    match v {
        Bson::Null | Bson::Undefined => CanonVal::Null,
        Bson::Int32(n) => CanonVal::Num(Dec::from_i64(i64::from(*n))),
        Bson::Int64(n) => CanonVal::Num(Dec::from_i64(*n)),
        Bson::Double(f) => Dec::from_f64(*f).map_or_else(|| CanonVal::Other(f.to_string()), CanonVal::Num),
        Bson::Decimal128(d) => {
            let s = d.to_string();
            Dec::parse(&s).map_or(CanonVal::Other(s), CanonVal::Num)
        }
        Bson::String(s) | Bson::Symbol(s) => CanonVal::Text(s.clone()),
        Bson::Document(_) | Bson::Array(_) => CanonVal::Json(v.clone().into_relaxed_extjson()),
        Bson::Binary(b) if b.subtype == BinarySubtype::Uuid && b.bytes.len() == 16 => {
            let mut u = [0u8; 16];
            u.copy_from_slice(&b.bytes);
            CanonVal::Uuid(u)
        }
        Bson::Binary(b) => CanonVal::Bytes(b.bytes.clone()),
        Bson::ObjectId(o) => CanonVal::Oid(o.bytes()),
        Bson::Boolean(b) => CanonVal::Bool(*b),
        Bson::DateTime(t) => CanonVal::Ts(i128::from(t.timestamp_millis()) * 1_000_000),
        other => CanonVal::Other(other.clone().into_relaxed_extjson().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::compare::CanonVal;

    fn keys(k: &[&str]) -> Vec<String> {
        k.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn resume_continues_after_the_last_key_column_by_column() {
        let f = resume_filter(&keys(&["a", "b"]), &[KeyVal::Int("3".into()), KeyVal::Text("x".into())]).unwrap();
        assert_eq!(
            f,
            doc! { "$or": [
                { "a": { "$gt": 3_i64 } },
                { "a": 3_i64, "b": { "$gt": "x" } },
            ] }
        );
    }

    #[test]
    fn page_keys_read_back_as_their_bson_types() {
        let oid = bson::oid::ObjectId::new();
        assert_eq!(key_bson(&KeyVal::Oid(oid.to_hex())).unwrap(), Bson::ObjectId(oid));
        assert_eq!(key_bson(&KeyVal::Num("2.5".into())).unwrap(), Bson::Double(2.5));
        assert!(matches!(key_bson(&KeyVal::Ts("2024-03-01T08:00:00Z".into())).unwrap(), Bson::DateTime(_)));
        assert!(key_bson(&KeyVal::Oid("nope".into())).is_err());
    }

    #[test]
    fn a_filter_is_combined_with_the_resume_point() {
        let k = keys(&["_id"]);
        let after = [KeyVal::Int("1".into())];
        let spec = ScanSpec {
            database: None,
            schema: None,
            table: "c",
            key_columns: &k,
            columns: &[],
            filter: Some(r#"{ "status": "active" }"#),
            after_key: Some(&after),
            literals: false,
        };
        assert_eq!(
            scan_filter(&spec).unwrap(),
            doc! { "$and": [{ "status": "active" }, { "$or": [{ "_id": { "$gt": 1_i64 } }] }] }
        );
        let bad = ScanSpec { filter: Some("{ status: "), after_key: None, ..spec };
        assert!(scan_filter(&bad).is_err());
    }

    #[test]
    fn values_compare_by_type_aware_equality() {
        use crate::db::compare::same;
        assert!(same(&canon(&Bson::Int32(1)), &canon(&Bson::Double(1.0))));
        let a = Bson::Document(doc! { "x": 1, "y": [1, 2] });
        let b = Bson::Document(doc! { "y": [1, 2], "x": 1.0 });
        let c = Bson::Document(doc! { "x": 1, "y": [2, 1] });
        assert!(same(&canon(&a), &canon(&b)));
        assert!(!same(&canon(&a), &canon(&c)));
        assert!(matches!(canon(&Bson::Null), CanonVal::Null));
        let oid = bson::oid::ObjectId::new();
        assert!(!same(&canon(&Bson::ObjectId(oid)), &canon(&Bson::String(oid.to_hex()))));
    }
}

#[cfg(test)]
mod live_tests {
    use bson::doc;

    use crate::api::{CompareChunk, CompareDataRequest, DiffKind, TableRef};
    use crate::db::mongodb::cancel::stop_tests::params;
    use crate::db::{compare_data_on, MongoAdapter, DIFF_PAGE_SIZE};

    fn side(collection: &str) -> TableRef {
        TableRef {
            conn_id: "c".into(),
            conn_key: String::new(),
            database: Some("dh_cmp_test".into()),
            schema: None,
            table: collection.into(),
        }
    }

    #[tokio::test]
    #[ignore = "requires a live MongoDB, see cancel::stop_tests"]
    async fn mongo_diff_by_object_id_with_a_filter() {
        let a = MongoAdapter::connect(&params()).await.unwrap();
        let db = a.client.database("dh_cmp_test");
        db.drop().await.unwrap();
        let ids: Vec<_> = (0..4).map(|_| bson::oid::ObjectId::new()).collect();
        db.collection("l")
            .insert_many([
                doc! { "_id": ids[0], "n": 1, "tags": { "a": 1, "b": 2 }, "s": "x" },
                doc! { "_id": ids[1], "n": 2, "s": "y" },
                doc! { "_id": ids[2], "n": 3, "s": "z" },
            ])
            .await
            .unwrap();
        db.collection("r")
            .insert_many([
                doc! { "_id": ids[0], "n": 1.0, "tags": { "b": 2, "a": 1 }, "s": "x" },
                doc! { "_id": ids[1], "n": 5, "s": "y" },
                doc! { "_id": ids[3], "n": 4, "s": "w" },
            ])
            .await
            .unwrap();

        let mut req = CompareDataRequest {
            left: side("l"),
            right: side("r"),
            key_columns: vec!["_id".into()],
            columns: vec!["n".into(), "tags".into(), "s".into()],
            filter: None,
            after_key: None,
            count_all: true,
            page_size: DIFF_PAGE_SIZE,
            run_id: uuid::Uuid::new_v4().to_string(),
        };
        let mut found = Vec::new();
        let mut sink = |c: CompareChunk| {
            if let CompareChunk::Rows { rows } = c {
                found.extend(rows);
            }
            Ok(())
        };
        let s = compare_data_on(&a, &a, "mongo-cmp-test", &req, &mut sink).await.unwrap();
        let c = s.counts;
        assert_eq!((c.identical, c.changed, c.left_only, c.right_only), (1, 1, 1, 1));
        assert_eq!(found[0].kind, DiffKind::Changed);
        assert_eq!(found[0].changed, Some(vec![0]));

        req.filter = Some(r#"{ "s": { "$in": ["x", "w"] } }"#.into());
        req.run_id = uuid::Uuid::new_v4().to_string();
        let mut sink = |_: CompareChunk| Ok(());
        let s = compare_data_on(&a, &a, "mongo-cmp-test", &req, &mut sink).await.unwrap();
        assert_eq!((s.counts.identical, s.counts.right_only, s.counts.left_only), (1, 1, 0));
        db.drop().await.unwrap();
    }
}
