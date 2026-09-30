//! Guessing Mongo references from field names and sampled values. Pure: it
//! never queries the database, so the same sample always gives the same links.

use crate::api::GraphLink;

/// What the sampler saw in one top level field.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct FieldStat {
    pub name: String,
    /// Non null sampled values.
    pub non_null: usize,
    /// Of those, ObjectIds or arrays of only ObjectIds.
    pub object_ids: usize,
    /// Of those, the arrays of only ObjectIds.
    pub arrays: usize,
}

// Longest first, so `_ids` is not read as `_id` plus an `s`.
const SUFFIXES: [&str; 5] = ["_ids", "Ids", "_id", "Id", "ID"];

fn base_of(field: &str) -> &str {
    for s in SUFFIXES {
        if let Some(base) = field.strip_suffix(s) {
            if !base.is_empty() {
                return base;
            }
        }
    }
    field
}

fn plural_of(base: &str, name: &str) -> bool {
    let (b, n) = (base.to_lowercase(), name.to_lowercase());
    n == format!("{b}s")
        || n == format!("{b}es")
        || b.strip_suffix('y').is_some_and(|stem| n == format!("{stem}ies"))
}

/// The one collection `field` points at, if exactly one fits: an exact name
/// match beats a plural one, and two equally good matches give none.
fn target<'a>(field: &str, collections: &'a [String]) -> Option<&'a str> {
    let base = base_of(field);
    let exact: Vec<&String> = collections.iter().filter(|c| c.eq_ignore_ascii_case(base)).collect();
    let pick = if exact.is_empty() {
        collections.iter().filter(|c| plural_of(base, c)).collect()
    } else {
        exact
    };
    match pick.as_slice() {
        [one] => Some(one.as_str()),
        _ => None,
    }
}

/// Every link from `collection` that its sampled fields suggest.
pub(crate) fn infer_links(collection: &str, fields: &[FieldStat], collections: &[String]) -> Vec<GraphLink> {
    fields
        .iter()
        .filter(|f| f.name != "_id" && f.non_null > 0 && f.object_ids * 2 > f.non_null)
        .filter_map(|f| {
            target(&f.name, collections).map(|to| GraphLink {
                id: format!("{collection}.{}", f.name),
                from_schema: None,
                from_table: collection.to_string(),
                from_columns: vec![f.name.clone()],
                to_schema: None,
                to_table: to.to_string(),
                to_columns: vec!["_id".to_string()],
                inferred: true,
                on_delete: None,
                unique: false,
                array: f.arrays * 2 > f.non_null,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(name: &str) -> FieldStat {
        FieldStat { name: name.into(), non_null: 10, object_ids: 10, arrays: 0 }
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn targets(field: FieldStat, collections: &[&str]) -> Vec<String> {
        infer_links("posts", &[field], &names(collections))
            .into_iter()
            .map(|l| l.to_table)
            .collect()
    }

    #[test]
    fn user_id_matches_users() {
        let links = infer_links("posts", &[oid("userId")], &names(&["posts", "users"]));
        assert_eq!(links.len(), 1);
        let l = &links[0];
        assert_eq!((l.id.as_str(), l.to_table.as_str()), ("posts.userId", "users"));
        assert_eq!(l.to_columns, ["_id"]);
        assert!(l.inferred);
    }

    #[test]
    fn a_missing_collection_gives_no_link() {
        assert!(targets(oid("authorId"), &["posts", "users"]).is_empty());
    }

    #[test]
    fn an_array_of_ids_matches_the_plural() {
        assert_eq!(targets(oid("tagIds"), &["tags"]), ["tags"]);
        assert_eq!(targets(oid("tag_ids"), &["tags"]), ["tags"]);
    }

    #[test]
    fn y_becomes_ies() {
        assert_eq!(targets(oid("categoryId"), &["categories"]), ["categories"]);
    }

    #[test]
    fn string_ids_give_no_link() {
        let strings = FieldStat { name: "user_id".into(), non_null: 10, object_ids: 0, arrays: 0 };
        assert!(targets(strings, &["users"]).is_empty());
    }

    #[test]
    fn exact_beats_plural() {
        assert_eq!(targets(oid("personId"), &["persons", "person"]), ["person"]);
    }

    #[test]
    fn two_equal_matches_give_none() {
        assert!(targets(oid("boxId"), &["boxs", "boxes"]).is_empty());
    }

    #[test]
    fn the_bare_name_and_case_count() {
        assert_eq!(targets(oid("Author"), &["authors"]), ["authors"]);
        assert_eq!(targets(oid("orgID"), &["Orgs"]), ["Orgs"]);
    }

    #[test]
    fn half_or_fewer_object_ids_give_no_link() {
        let half = FieldStat { name: "userId".into(), non_null: 10, object_ids: 5, arrays: 0 };
        assert!(targets(half, &["users"]).is_empty());
    }

    #[test]
    fn mostly_arrays_set_the_array_flag() {
        let tags = FieldStat { name: "tagIds".into(), non_null: 10, object_ids: 10, arrays: 6 };
        let links = infer_links("posts", &[tags, oid("userId")], &names(&["tags", "users"]));
        let flags: Vec<_> = links.iter().map(|l| (l.to_table.as_str(), l.array, l.unique)).collect();
        assert_eq!(flags, [("tags", true, false), ("users", false, false)]);
    }

    #[test]
    fn half_or_fewer_arrays_leave_it_off() {
        let tags = FieldStat { name: "tagIds".into(), non_null: 10, object_ids: 10, arrays: 5 };
        assert!(!infer_links("posts", &[tags], &names(&["tags"]))[0].array);
    }

    #[test]
    fn id_itself_is_never_a_link() {
        assert!(infer_links("users", &[oid("_id")], &names(&["users"])).is_empty());
    }
}
