use std::collections::HashMap;
use futures_util::{StreamExt, TryStreamExt};
use crate::api::{GraphColumn, GraphTable, MongoGraphEvent};
use crate::db::{DbError, DbResult, GraphSink, RunHandle};
use super::convert::bson_type_name;
use super::infer_links::{infer_links, FieldStat};
use super::MongoAdapter;

const SAMPLE_SIZE: i64 = 200;
const IN_FLIGHT: usize = 8;

fn mongo_err(e: mongodb::error::Error) -> DbError {
    DbError::InvalidOperation(format!("mongo: {e}"))
}

fn is_object_id_like(v: &bson::Bson) -> bool {
    match v {
        bson::Bson::ObjectId(_) => true,
        bson::Bson::Array(a) => !a.is_empty() && a.iter().all(|x| matches!(x, bson::Bson::ObjectId(_))),
        _ => false,
    }
}

#[derive(Default)]
struct Seen {
    types: HashMap<&'static str, usize>,
    non_null: usize,
    object_ids: usize,
    arrays: usize,
}

/// A collection's top level fields in first seen order, `_id` first, each
/// with its most frequent non null type, plus the stats inference needs.
fn summarize(docs: &[bson::Document]) -> (Vec<GraphColumn>, Vec<FieldStat>) {
    let mut order: Vec<String> = Vec::new();
    let mut seen: HashMap<String, Seen> = HashMap::new();
    for doc in docs {
        for (k, v) in doc.iter() {
            let s = seen.entry(k.clone()).or_insert_with(|| {
                order.push(k.clone());
                Seen::default()
            });
            if matches!(v, bson::Bson::Null | bson::Bson::Undefined) {
                continue;
            }
            s.non_null += 1;
            *s.types.entry(bson_type_name(v)).or_insert(0) += 1;
            if is_object_id_like(v) {
                s.object_ids += 1;
                if matches!(v, bson::Bson::Array(_)) {
                    s.arrays += 1;
                }
            }
        }
    }
    if let Some(at) = order.iter().position(|n| n == "_id") {
        let id = order.remove(at);
        order.insert(0, id);
    }
    let mut columns = Vec::new();
    let mut stats = Vec::new();
    for name in order {
        let s = &seen[&name];
        let mut ranked: Vec<_> = s.types.iter().collect();
        ranked.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        let data_type = ranked.first().map(|(t, _)| t.to_string()).unwrap_or_else(|| "null".into());
        columns.push(GraphColumn {
            primary_key: name == "_id",
            name: name.clone(),
            data_type,
            not_null: false,
        });
        stats.push(FieldStat { name, non_null: s.non_null, object_ids: s.object_ids, arrays: s.arrays });
    }
    (columns, stats)
}

impl MongoAdapter {
    async fn sample_docs(&self, database: &str, collection: &str) -> DbResult<Vec<bson::Document>> {
        self.client
            .database(database)
            .collection::<bson::Document>(collection)
            .find(bson::doc! {})
            .limit(SAMPLE_SIZE)
            .await
            .map_err(mongo_err)?
            .try_collect()
            .await
            .map_err(mongo_err)
    }

    /// Sample every collection of `database` and send each one as it
    /// finishes, with the links it suggests. Stops when `run` is cancelled,
    /// keeping what was already sent.
    pub(super) async fn mongo_graph(
        &self,
        database: &str,
        run: Option<&RunHandle>,
        sink: GraphSink<'_>,
    ) -> DbResult<()> {
        let mut names = self
            .client
            .database(database)
            .list_collection_names()
            .await
            .map_err(mongo_err)?;
        names.retain(|n| !n.starts_with("system."));
        names.sort();
        sink(MongoGraphEvent::Start { total: names.len(), collections: names.clone() })?;

        let all = &names;
        let mut samples = futures_util::stream::iter(names.iter().cloned())
            .map(|name| async move {
                let res = self.sample_docs(database, &name).await;
                (name, res)
            })
            .buffer_unordered(IN_FLIGHT);
        while let Some((name, res)) = samples.next().await {
            if run.is_some_and(RunHandle::is_cancel_requested) {
                break;
            }
            let event = match res {
                Ok(docs) => {
                    let (columns, stats) = summarize(&docs);
                    MongoGraphEvent::Collection {
                        links: infer_links(&name, &stats, all),
                        table: GraphTable { schema: None, name, stub: false, columns, error: None },
                    }
                }
                Err(e) => MongoGraphEvent::Collection {
                    table: GraphTable {
                        schema: None,
                        name,
                        stub: false,
                        columns: Vec::new(),
                        error: Some(e.to_string()),
                    },
                    links: Vec::new(),
                },
            };
            sink(event)?;
        }
        sink(MongoGraphEvent::Done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::{doc, oid::ObjectId};

    #[test]
    fn id_comes_first_and_types_skip_nulls() {
        let docs = vec![
            doc! { "name": "a", "_id": ObjectId::new(), "ownerId": bson::Bson::Null },
            doc! { "_id": ObjectId::new(), "ownerId": ObjectId::new(), "tags": [ObjectId::new()] },
        ];
        let (columns, stats) = summarize(&docs);
        let names: Vec<_> = columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["_id", "name", "ownerId", "tags"]);
        assert!(columns[0].primary_key);
        assert_eq!(columns[2].data_type, "objectid");
        assert_eq!(columns[3].data_type, "array");
        let owner = stats.iter().find(|s| s.name == "ownerId").unwrap();
        assert_eq!((owner.non_null, owner.object_ids, owner.arrays), (1, 1, 0));
        let tags = stats.iter().find(|s| s.name == "tags").unwrap();
        assert_eq!((tags.object_ids, tags.arrays), (1, 1));
    }

    #[test]
    fn a_field_that_is_always_null_reads_as_null() {
        let (columns, _) = summarize(&[doc! { "_id": 1, "gone": bson::Bson::Null }]);
        assert_eq!(columns[1].data_type, "null");
    }
}
