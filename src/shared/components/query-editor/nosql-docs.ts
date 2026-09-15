import { maskComments } from "@/shared/lib/utils";
import { wordAt, type DocEntry, type DocResolver } from "./doc-hover";

/** `db.<collection>.<method>(...)` methods — matches `NOSQL_SHELL_COMPLETIONS`
 *  in `nosql-completions.ts` 1:1, so anything offered as a completion has a
 *  hover doc too. Keyed by exact (case-sensitive) method name. */
export const MONGO_METHOD_DOCS: Record<string, DocEntry> = {
  find: {
    name: "find()",
    signature: "db.<collection>.find(filter?)",
    summary: "Returns every document matching the filter.",
    description:
      "Omit the filter (or pass `{}`) to match every document in the collection. Chain `.limit(n)`, `.sort({...})`, or `.skip(n)` after the call to further shape the result.",
    examples: [
      "db.users.find({ active: true })",
      'db.orders.find({ status: "pending" }).sort({ createdAt: -1 }).limit(20)',
    ],
  },
  findOne: {
    name: "findOne()",
    signature: "db.<collection>.findOne(filter?)",
    summary: "Returns the first document matching the filter, or null.",
    description:
      "Same filter syntax as `find()`, but returns a single document (or nothing) instead of a cursor/array — convenient when you only expect (or only care about) one match.",
    examples: [
      'db.users.findOne({ email: "ada@example.com" })',
      'db.orders.findOne({ status: "pending" })',
    ],
  },
  countDocuments: {
    name: "countDocuments()",
    signature: "db.<collection>.countDocuments(filter?)",
    summary: "Counts documents matching the filter — accurate, scans matches.",
    description:
      "The modern, accurate way to count — unlike the legacy `count()`, it does a real filtered scan rather than trusting a (potentially stale) collection metadata estimate.",
    examples: [
      'db.orders.countDocuments({ status: "pending" })',
      "db.users.countDocuments({})",
    ],
  },
  count: {
    name: "count()",
    signature: "db.<collection>.count(filter?)",
    summary:
      "Counts documents matching the filter — legacy alias for countDocuments().",
    description:
      "Kept for familiarity with older Mongo shell habits; behaves the same as `countDocuments()` here. Prefer `countDocuments()` in new queries.",
    examples: ['db.orders.count({ status: "pending" })', "db.users.count({})"],
  },
  distinct: {
    name: "distinct()",
    signature: 'db.<collection>.distinct("field", filter?)',
    summary:
      "Returns the unique values of one field across matching documents.",
    description:
      "First argument is the field name as a string; the optional second argument is a filter, same shape as `find()`'s, to restrict which documents are considered.",
    examples: [
      'db.users.distinct("country")',
      'db.orders.distinct("status", { createdAt: { $gt: "2024-01-01" } })',
    ],
  },
  aggregate: {
    name: "aggregate()",
    signature: "db.<collection>.aggregate([ { $stage: ... }, ... ])",
    summary: "Runs a multi-stage pipeline — filter, group, reshape, and more.",
    description:
      "Each element of the array is one pipeline stage, run in order — the output of one stage feeds the next. Common stages: `$match` (filter, like `find`'s filter), `$group` (aggregate by key), `$project`/`$set` (reshape/add fields), `$sort`, `$limit`, `$lookup` (join another collection).",
    examples: [
      'db.orders.aggregate([\n  { $match: { status: "completed" } },\n  { $group: { _id: "$userId", total: { $sum: "$amount" } } },\n  { $sort: { total: -1 } }\n])',
      'db.users.aggregate([\n  { $match: { active: true } },\n  { $count: "activeUsers" }\n])',
    ],
  },
  insertOne: {
    name: "insertOne()",
    signature: "db.<collection>.insertOne(document)",
    summary: "Inserts a single new document.",
    description:
      "`document` is a plain JSON object — an `_id` is generated automatically if you don't supply one.",
    examples: [
      'db.users.insertOne({ name: "Ada", email: "ada@example.com" })',
      'db.orders.insertOne({ userId: "u1", total: 42.5, status: "pending" })',
    ],
  },
  insertMany: {
    name: "insertMany()",
    signature: "db.<collection>.insertMany([document, ...])",
    summary: "Inserts several new documents in one call.",
    description:
      "Argument is a JSON array of documents, each inserted the same way `insertOne()` would insert one — `_id`s are generated automatically for any document that doesn't supply one.",
    examples: [
      'db.tags.insertMany([{ name: "urgent" }, { name: "follow-up" }])',
      'db.users.insertMany([\n  { name: "Ada", email: "ada@example.com" },\n  { name: "Grace", email: "grace@example.com" }\n])',
    ],
  },
  updateOne: {
    name: "updateOne()",
    signature: "db.<collection>.updateOne(filter, update)",
    summary: "Updates the first document matching the filter.",
    description:
      "`update` normally uses update operators (`$set`, `$inc`, `$push`, ...) to modify specific fields — passing a plain document with no operators REPLACES the whole matched document instead, which is rarely what you want.",
    examples: [
      'db.orders.updateOne({ _id: "abc" }, { $set: { status: "shipped" } })',
      'db.counters.updateOne({ _id: "views" }, { $inc: { count: 1 } })',
    ],
  },
  updateMany: {
    name: "updateMany()",
    signature: "db.<collection>.updateMany(filter, update)",
    summary: "Updates every document matching the filter.",
    description:
      "Same `update` operator rules as `updateOne()` (`$set`, `$inc`, ...), but applied to ALL matching documents — double-check the filter before running, especially an empty `{}` filter, which matches the whole collection.",
    examples: [
      'db.orders.updateMany({ status: "pending" }, { $set: { status: "processing" } })',
      'db.products.updateMany({ category: "clearance" }, { $mul: { price: 0.8 } })',
    ],
  },
  deleteOne: {
    name: "deleteOne()",
    signature: "db.<collection>.deleteOne(filter)",
    summary: "Deletes the first document matching the filter.",
    description:
      "Irreversible. With no documents matching, it's a no-op (not an error).",
    examples: [
      'db.sessions.deleteOne({ _id: "abc" })',
      'db.users.deleteOne({ email: "ada@example.com" })',
    ],
  },
  deleteMany: {
    name: "deleteMany()",
    signature: "db.<collection>.deleteMany(filter)",
    summary: "Deletes every document matching the filter.",
    description:
      "Irreversible, and there's no confirmation step — an empty `{}` filter deletes the entire collection's contents. Double-check the filter (or run the equivalent `find()` first) before running it.",
    examples: [
      'db.sessions.deleteMany({ expiresAt: { $lt: "2024-01-01" } })',
      'db.logs.deleteMany({ level: "debug" })',
    ],
  },
  sort: {
    name: ".sort()",
    signature: ".find(...).sort({ field: 1 | -1, ... })",
    summary: "Orders a find() result — 1 ascending, -1 descending.",
    description:
      "Chained after `find()`. Multiple fields break ties in the order listed, same as SQL's `ORDER BY a, b`.",
    examples: [
      "db.orders.find({}).sort({ createdAt: -1 })",
      "db.users.find({}).sort({ lastName: 1, firstName: 1 })",
    ],
  },
  limit: {
    name: ".limit()",
    signature: ".find(...).limit(n)",
    summary: "Caps a find() result to at most n documents.",
    description:
      "Chained after `find()` (and typically after `.sort()`, applied last) — the usual way to bound a potentially large result set.",
    examples: [
      "db.logs.find({}).sort({ createdAt: -1 }).limit(50)",
      "db.users.find({ active: true }).limit(10)",
    ],
  },
  skip: {
    name: ".skip()",
    signature: ".find(...).skip(n)",
    summary: "Skips the first n documents of a find() result.",
    description:
      "Chained after `find()`, usually with `.sort()` and `.limit()` for pagination. Without a stable sort, which documents get skipped isn't guaranteed across runs.",
    examples: [
      "db.logs.find({}).sort({ createdAt: -1 }).skip(50).limit(50)",
      "db.users.find({}).sort({ _id: 1 }).skip(100).limit(25)",
    ],
  },
  pretty: {
    name: ".pretty()",
    signature: ".find(...).pretty()",
    summary: "No-op here — this console already formats results readably.",
    description:
      "Tolerated for compatibility with scripts copied from the real Mongo shell, where it pretty-prints JSON output in a terminal; this console already renders results as a table/tree, so it has no extra effect here.",
    examples: [
      "db.users.find({}).pretty()",
      'db.orders.find({ status: "pending" }).limit(5).pretty()',
    ],
  },
};

/** `$operator`/`$stage` names offered by `nosql-completions.ts`'s
 *  `TOP_LEVEL_OPERATORS`/`FIELD_OPERATORS`/`AGGREGATION_STAGES`/
 *  `UPDATE_OPERATORS` — same "everything offered as a completion has a
 *  hover doc" scope as `MONGO_METHOD_DOCS`. `$set`/`$unset` mean two
 *  different things depending on context (an update operator vs. an
 *  aggregation stage) — one entry each, covering both. */
export const MONGO_OPERATOR_DOCS: Record<string, DocEntry> = {
  // ---- logical (top-level filter) -------------------------------------------
  $and: {
    name: "$and",
    signature: "{ $and: [ { ... }, { ... } ] }",
    summary: "Matches only if every condition in the array is true.",
    description:
      "Implicit already when a filter has multiple fields (`{ a: 1, b: 2 }` is already an AND) — `$and` is for when you need two conditions on the SAME field, which a plain object can't express.",
    examples: [
      "db.orders.find({ $and: [{ total: { $gt: 100 } }, { total: { $lt: 500 } }] })",
    ],
  },
  $or: {
    name: "$or",
    signature: "{ $or: [ { ... }, { ... } ] }",
    summary: "Matches if any condition in the array is true.",
    description:
      "The array elements are each a full filter document, same shape `find()` itself takes.",
    examples: [
      'db.orders.find({ $or: [{ status: "pending" }, { status: "failed" }] })',
    ],
  },
  $nor: {
    name: "$nor",
    signature: "{ $nor: [ { ... }, { ... } ] }",
    summary: "Matches only if NONE of the conditions in the array are true.",
    description:
      "The inverse of `$or` — every listed condition must be false for a document to match.",
    examples: [
      'db.orders.find({ $nor: [{ status: "cancelled" }, { status: "refunded" }] })',
    ],
  },
  $expr: {
    name: "$expr",
    signature: "{ $expr: { <aggregation expression> } }",
    summary: "Lets a filter compare two fields on the same document.",
    description:
      "A plain filter can only compare a field to a literal value — `$expr` allows an aggregation-style expression instead, which can reference other fields on the same document.",
    examples: ['db.orders.find({ $expr: { $gt: ["$shipped", "$ordered"] } })'],
  },

  // ---- comparison/element (inside a field's condition) -----------------------
  $eq: {
    name: "$eq",
    signature: "{ field: { $eq: value } }",
    summary: "Equals — same as { field: value } without the operator.",
    description:
      "Rarely needed on its own; mostly useful combined with other operators, or generated by query builders.",
    examples: ['db.users.find({ status: { $eq: "active" } })'],
  },
  $ne: {
    name: "$ne",
    signature: "{ field: { $ne: value } }",
    summary: "Not equal to the given value.",
    description:
      "Matches documents where the field is present with a different value, OR the field is missing entirely.",
    examples: ['db.orders.find({ status: { $ne: "cancelled" } })'],
  },
  $gt: {
    name: "$gt",
    signature: "{ field: { $gt: value } }",
    summary: "Greater than the given value.",
    description: "Works on numbers, dates, and (lexicographically) strings.",
    examples: ["db.orders.find({ total: { $gt: 100 } })"],
  },
  $gte: {
    name: "$gte",
    signature: "{ field: { $gte: value } }",
    summary: "Greater than or equal to the given value.",
    description:
      "Same comparison rules as `$gt`, inclusive of the boundary value.",
    examples: ["db.users.find({ age: { $gte: 18 } })"],
  },
  $lt: {
    name: "$lt",
    signature: "{ field: { $lt: value } }",
    summary: "Less than the given value.",
    description: "Works on numbers, dates, and (lexicographically) strings.",
    examples: ['db.logs.find({ createdAt: { $lt: "2024-01-01" } })'],
  },
  $lte: {
    name: "$lte",
    signature: "{ field: { $lte: value } }",
    summary: "Less than or equal to the given value.",
    description:
      "Same comparison rules as `$lt`, inclusive of the boundary value.",
    examples: ["db.orders.find({ total: { $lte: 500 } })"],
  },
  $in: {
    name: "$in",
    signature: "{ field: { $in: [ value, ... ] } }",
    summary: "Matches if the field equals any value in the array.",
    description:
      "Shorthand for chaining several `$or`/`$eq` conditions on the same field.",
    examples: [
      'db.orders.find({ status: { $in: ["pending", "processing"] } })',
    ],
  },
  $nin: {
    name: "$nin",
    signature: "{ field: { $nin: [ value, ... ] } }",
    summary: "Matches if the field does NOT equal any value in the array.",
    description:
      "The inverse of `$in` — also matches documents where the field is missing entirely.",
    examples: [
      'db.orders.find({ status: { $nin: ["cancelled", "refunded"] } })',
    ],
  },
  $exists: {
    name: "$exists",
    signature: "{ field: { $exists: true | false } }",
    summary: "Matches based on whether the field is present at all.",
    description:
      "`true` matches documents that have the field (even if its value is null); `false` matches documents missing it entirely.",
    examples: ["db.users.find({ deletedAt: { $exists: false } })"],
  },
  $regex: {
    name: "$regex",
    signature: '{ field: { $regex: "pattern", $options: "i" } }',
    summary: "Matches text against a regular expression.",
    description:
      '`$options: "i"` makes the match case-insensitive; omit it for a case-sensitive match. A literal `/pattern/flags` value works the same way without needing `$regex` explicitly.',
    examples: [
      'db.users.find({ email: { $regex: "@gmail\\\\.com$", $options: "i" } })',
    ],
  },
  $type: {
    name: "$type",
    signature: '{ field: { $type: "string" | 2 | ... } }',
    summary: "Matches based on the BSON type of the field's value.",
    description:
      "Useful when a field's type is inconsistent across documents (e.g. some old records stored a number as a string).",
    examples: ['db.users.find({ age: { $type: "int" } })'],
  },
  $size: {
    name: "$size",
    signature: "{ arrayField: { $size: n } }",
    summary: "Matches an array field with exactly n elements.",
    description:
      "Exact match only — there's no `$size: { $gt: n }` form; for range checks on array length, use `$expr` with `$size` the aggregation operator instead.",
    examples: ["db.orders.find({ items: { $size: 3 } })"],
  },
  $all: {
    name: "$all",
    signature: "{ arrayField: { $all: [ value, ... ] } }",
    summary: "Matches an array field that contains every listed value.",
    description:
      "Unlike `$in` (matches if ANY value is present), `$all` requires ALL listed values to be present — order and extra elements don't matter.",
    examples: ['db.posts.find({ tags: { $all: ["urgent", "bug"] } })'],
  },
  $elemMatch: {
    name: "$elemMatch",
    signature: "{ arrayField: { $elemMatch: { ... } } }",
    summary:
      "Matches if AT LEAST ONE array element satisfies every condition together.",
    description:
      "Without it, conditions on different fields of an array-of-objects can each match a DIFFERENT element — `$elemMatch` requires one single element to satisfy all of them at once.",
    examples: [
      'db.orders.find({ items: { $elemMatch: { sku: "A1", qty: { $gte: 2 } } } })',
    ],
  },
  $mod: {
    name: "$mod",
    signature: "{ field: { $mod: [divisor, remainder] } }",
    summary: "Matches if field % divisor === remainder.",
    description: "Both `divisor` and `remainder` are required, in that order.",
    examples: ["db.items.find({ quantity: { $mod: [4, 0] } })"],
  },
  $not: {
    name: "$not",
    signature: "{ field: { $not: { <operator expression> } } }",
    summary: "Negates the operator expression that follows it.",
    description:
      "Wraps another operator, not a plain value — for a plain not-equal, use `$ne` instead.",
    examples: ["db.users.find({ age: { $not: { $lt: 18 } } })"],
  },

  // ---- aggregation pipeline stages -------------------------------------------
  $match: {
    name: "$match",
    signature: "{ $match: { <filter> } }",
    summary:
      "Filters documents — the aggregation equivalent of find()'s filter.",
    description:
      "Usually the first stage in a pipeline, so later stages only process documents that matter — same filter syntax `find()` takes.",
    examples: ['db.orders.aggregate([{ $match: { status: "completed" } }])'],
  },
  $group: {
    name: "$group",
    signature: '{ $group: { _id: "$field", total: { $sum: "$amount" } } }',
    summary: "Groups documents by a key and computes aggregates per group.",
    description:
      "`_id` is the grouping key (a field reference, an expression, or `null` to group everything into one bucket); every other key defines an accumulator (`$sum`, `$avg`, `$min`, `$max`, `$push`, ...) computed per group.",
    examples: [
      'db.orders.aggregate([{ $group: { _id: "$userId", total: { $sum: "$amount" } } }])',
    ],
  },
  $project: {
    name: "$project",
    signature: "{ $project: { field: 1, other: 0, computed: { ... } } }",
    summary: "Reshapes each document — include, exclude, or compute fields.",
    description:
      "`1` includes a field, `0` excludes it (can't mix inclusion and exclusion except for `_id`, which can always be dropped with `0`); any other value computes a new field.",
    examples: [
      "db.users.aggregate([{ $project: { name: 1, email: 1, _id: 0 } }])",
    ],
  },
  $sort: {
    name: "$sort (aggregation stage)",
    signature: "{ $sort: { field: 1 | -1, ... } }",
    summary: "Orders documents within the pipeline — same as .sort().",
    description:
      "1 for ascending, -1 for descending. Placing `$sort` right after `$group` sorts the grouped results, which `.sort()` on its own can't do.",
    examples: [
      'db.orders.aggregate([{ $group: { _id: "$userId", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }])',
    ],
  },
  $limit: {
    name: "$limit (aggregation stage)",
    signature: "{ $limit: n }",
    summary: "Caps the pipeline to at most n documents at this point.",
    description:
      "Same effect as `.limit()`, but as an explicit stage — useful right after `$sort` to take a top-N, or anywhere mid-pipeline to bound how much later stages process.",
    examples: [
      "db.orders.aggregate([{ $sort: { total: -1 } }, { $limit: 10 }])",
    ],
  },
  $skip: {
    name: "$skip (aggregation stage)",
    signature: "{ $skip: n }",
    summary: "Skips the first n documents at this point in the pipeline.",
    description:
      "Same effect as `.skip()`, but as an explicit stage — usually paired with `$sort` and `$limit` for pagination inside a pipeline.",
    examples: [
      "db.orders.aggregate([{ $sort: { _id: 1 } }, { $skip: 20 }, { $limit: 10 }])",
    ],
  },
  $unwind: {
    name: "$unwind",
    signature: '{ $unwind: "$arrayField" }',
    summary:
      "Splits one document with an array field into one document per element.",
    description:
      "A document with a 3-element array becomes 3 documents, each with that field replaced by a single element. A document where the field is missing or an empty array is dropped by default.",
    examples: ['db.orders.aggregate([{ $unwind: "$items" }])'],
  },
  $lookup: {
    name: "$lookup",
    signature:
      '{ $lookup: { from: "coll", localField: "f", foreignField: "f", as: "out" } }',
    summary: "Joins in documents from another collection.",
    description:
      "An equality join: for each document, matches `localField` against `foreignField` in `from`, and adds the matches as an array under `as`.",
    examples: [
      'db.orders.aggregate([{ $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } }])',
    ],
  },
  $addFields: {
    name: "$addFields",
    signature: "{ $addFields: { newField: <expression> } }",
    summary:
      "Adds (or overwrites) fields without dropping the rest of the document.",
    description:
      "Unlike `$project`, every existing field is kept automatically — only the named fields are added/changed. `$set` is an alias for this stage.",
    examples: [
      'db.orders.aggregate([{ $addFields: { total: { $multiply: ["$price", "$qty"] } } }])',
    ],
  },
  $count: {
    name: "$count",
    signature: '{ $count: "fieldName" }',
    summary: "Replaces the pipeline's documents with a single count.",
    description:
      "Outputs one document, `{ fieldName: <number of documents reaching this stage> }` — usually the last stage in a pipeline.",
    examples: [
      'db.orders.aggregate([{ $match: { status: "pending" } }, { $count: "pendingOrders" }])',
    ],
  },
  $facet: {
    name: "$facet",
    signature: "{ $facet: { name1: [ ...pipeline ], name2: [ ...pipeline ] } }",
    summary: "Runs several independent sub-pipelines against the same input.",
    description:
      "Useful for computing multiple, differently-shaped results (e.g. a page of results AND a total count) in one round trip instead of two separate queries.",
    examples: [
      'db.orders.aggregate([{ $facet: { page: [{ $skip: 0 }, { $limit: 10 }], total: [{ $count: "count" }] } }])',
    ],
  },
  $bucket: {
    name: "$bucket",
    signature: '{ $bucket: { groupBy: "$field", boundaries: [...] } }',
    summary: "Groups documents into ranges (buckets) of a field's value.",
    description:
      "`boundaries` is a sorted array of bucket edges; each document falls into the bucket whose range contains its `groupBy` value.",
    examples: [
      'db.orders.aggregate([{ $bucket: { groupBy: "$total", boundaries: [0, 100, 500, 1000] } }])',
    ],
  },
  $replaceRoot: {
    name: "$replaceRoot",
    signature: "{ $replaceRoot: { newRoot: <expression> } }",
    summary: "Replaces the whole document with the given expression's value.",
    description:
      "Commonly used with `$mergeObjects` to promote a nested subdocument up to be the top-level document.",
    examples: [
      'db.orders.aggregate([{ $replaceRoot: { newRoot: "$shippingAddress" } }])',
    ],
  },
  $sample: {
    name: "$sample",
    signature: "{ $sample: { size: n } }",
    summary: "Picks n random documents from the pipeline.",
    description:
      "Useful for spot-checking data without scanning (or sorting) the whole collection.",
    examples: ["db.users.aggregate([{ $sample: { size: 5 } }])"],
  },
  $out: {
    name: "$out",
    signature: '{ $out: "targetCollection" }',
    summary:
      "Writes the pipeline's final result to a collection, replacing it.",
    description:
      "Must be the LAST stage. If `targetCollection` already exists, it's atomically replaced — this is a real write, not a preview.",
    examples: [
      'db.orders.aggregate([{ $group: { _id: "$userId", total: { $sum: "$amount" } } }, { $out: "user_totals" }])',
    ],
  },
  $merge: {
    name: "$merge",
    signature: '{ $merge: { into: "targetCollection" } }',
    summary: "Writes the pipeline's result into a collection, merging by key.",
    description:
      "Like `$out`, but merges into existing documents (matched by `on`, `_id` by default) instead of replacing the whole collection — the usual choice for incrementally updating a materialized/summary collection.",
    examples: [
      'db.orders.aggregate([{ $group: { _id: "$userId", total: { $sum: "$amount" } } }, { $merge: { into: "user_totals" } }])',
    ],
  },

  // ---- update operators --------------------------------------------------
  $set: {
    name: "$set",
    signature:
      "{ $set: { field: value, ... } } — update operator or aggregation stage",
    summary:
      "As an update: sets field values. As a pipeline stage: alias for $addFields.",
    description:
      "In `updateOne()`/`updateMany()`, `$set` assigns the listed fields to new values without touching anything else on the document — the usual way to update specific fields instead of replacing the whole document. In an `aggregate()` pipeline, `$set` is exactly `$addFields` under a different name.",
    examples: [
      'db.orders.updateOne({ _id: "abc" }, { $set: { status: "shipped" } })',
    ],
  },
  $unset: {
    name: "$unset",
    signature:
      '{ $unset: { field: "" } } — update operator or aggregation stage',
    summary:
      "As an update: removes fields entirely. As a pipeline stage: drops fields from the output.",
    description:
      "In `updateOne()`/`updateMany()`, the value for each key is ignored (conventionally an empty string) — the field is deleted from the document. In an `aggregate()` pipeline, `$unset` takes a field name or array of names to drop from the output instead.",
    examples: [
      'db.users.updateOne({ _id: "abc" }, { $unset: { tempFlag: "" } })',
    ],
  },
  $inc: {
    name: "$inc",
    signature: "{ $inc: { field: amount } }",
    summary:
      "Increments (or decrements, with a negative amount) a numeric field.",
    description:
      "Atomic — safe under concurrent updates, unlike reading the value and writing back `value + 1` yourself. Creates the field (starting from 0) if it doesn't exist yet.",
    examples: [
      'db.counters.updateOne({ _id: "views" }, { $inc: { count: 1 } })',
    ],
  },
  $mul: {
    name: "$mul",
    signature: "{ $mul: { field: factor } }",
    summary: "Multiplies a numeric field by the given factor.",
    description:
      "Same atomicity guarantee as `$inc`. If the field doesn't exist yet, it's set to 0.",
    examples: [
      'db.products.updateMany({ category: "clearance" }, { $mul: { price: 0.8 } })',
    ],
  },
  $min: {
    name: "$min",
    signature: "{ $min: { field: value } }",
    summary:
      "Sets the field only if the given value is LESS than its current value.",
    description:
      'A no-op if the field already holds a smaller value, or doesn\'t exist and the update would raise it — useful for "keep the smallest seen so far" fields.',
    examples: [
      'db.stats.updateOne({ _id: "latency" }, { $min: { best: 42 } })',
    ],
  },
  $max: {
    name: "$max",
    signature: "{ $max: { field: value } }",
    summary:
      "Sets the field only if the given value is GREATER than its current value.",
    description:
      'The inverse of `$min` — useful for "keep the largest seen so far" fields, e.g. a high score.',
    examples: ['db.stats.updateOne({ _id: "score" }, { $max: { best: 100 } })'],
  },
  $push: {
    name: "$push",
    signature: "{ $push: { arrayField: value } }",
    summary: "Appends a value to an array field.",
    description:
      "Creates the array if the field doesn't exist yet. Combine with `$each` to push several values at once: `{ $push: { arrayField: { $each: [v1, v2] } } }`.",
    examples: [
      'db.orders.updateOne({ _id: "abc" }, { $push: { tags: "urgent" } })',
    ],
  },
  $pull: {
    name: "$pull",
    signature: "{ $pull: { arrayField: value | { <condition> } } }",
    summary: "Removes every array element matching a value or condition.",
    description:
      "Removes ALL matching elements, not just the first — pass a plain value for an exact match, or a condition object for anything more complex.",
    examples: [
      'db.orders.updateOne({ _id: "abc" }, { $pull: { tags: "urgent" } })',
    ],
  },
  $addToSet: {
    name: "$addToSet",
    signature: "{ $addToSet: { arrayField: value } }",
    summary: "Appends a value to an array only if it isn't already present.",
    description:
      "Like `$push`, but de-duplicates — the usual choice when an array is meant to behave like a set.",
    examples: [
      'db.users.updateOne({ _id: "abc" }, { $addToSet: { roles: "admin" } })',
    ],
  },
  $pop: {
    name: "$pop",
    signature: "{ $pop: { arrayField: 1 | -1 } }",
    summary: "Removes the first (-1) or last (1) element of an array.",
    description:
      "Only ever removes exactly one element, from one end of the array.",
    examples: ['db.queues.updateOne({ _id: "abc" }, { $pop: { items: -1 } })'],
  },
  $rename: {
    name: "$rename",
    signature: '{ $rename: { oldField: "newField" } }',
    summary: "Renames a field, keeping its value.",
    description:
      "The new name must not already be in use on the document, or its existing value is overwritten.",
    examples: ['db.users.updateMany({}, { $rename: { fullName: "name" } })'],
  },
  $currentDate: {
    name: "$currentDate",
    signature: "{ $currentDate: { field: true } }",
    summary: "Sets a field to the current date/time.",
    description:
      "The usual way to stamp `updatedAt`-style fields on every write, without computing the timestamp client-side.",
    examples: [
      'db.orders.updateOne({ _id: "abc" }, { $currentDate: { updatedAt: true } })',
    ],
  },
};

/** Top-level shell commands, not tied to a specific collection. */
export const MONGO_KEYWORD_DOCS: Record<string, DocEntry> = {
  use: {
    name: "use",
    signature: "use <database>",
    summary: "Switches the console to a different database on this connection.",
    description:
      "Every query typed after this runs against the named database instead, until the next `use` (or until you switch it from the database selector in the toolbar).",
    examples: ["use analytics", "use reporting"],
  },
  show: {
    name: "show dbs / show collections",
    signature: "show dbs | show collections",
    summary: "Lists databases, or collections in the current database.",
    description:
      "`show dbs` lists every database visible on this connection; `show collections` lists the collections in whichever database `use` last selected.",
    examples: ["show dbs", "show collections"],
  },
};

/** Resolves a hover position to a documented Mongo shell symbol —
 *  context-aware to avoid false positives on ordinary JSON field names that
 *  happen to share a method's name (a filter field literally called
 *  `count`, say): a method doc only matches right after a `.` (a real call
 *  position, `db.users.find`/`.find(...).limit`), and a shell-keyword doc
 *  only matches when the word is the first thing on its line. `$operator`
 *  names (see `MONGO_OPERATOR_DOCS`) start with a literal `$` — unambiguous
 *  enough (real field names essentially never start with `$`) to match
 *  anywhere, no extra position check needed. Runs against a comment-masked
 *  copy of the text (see `maskComments`) so a mention inside a `//` comment
 *  is never treated as a real call. */
export const resolveMongoDoc: DocResolver = (doc, pos) => {
  const masked = maskComments(doc);
  const w = wordAt(masked, pos);
  if (!w) return null;

  if (w.text.startsWith("$")) {
    const entry = MONGO_OPERATOR_DOCS[w.text];
    return entry ? { entry, from: w.from, to: w.to } : null;
  }

  if (masked[w.from - 1] === ".") {
    const entry = MONGO_METHOD_DOCS[w.text];
    return entry ? { entry, from: w.from, to: w.to } : null;
  }

  const lineStart = masked.lastIndexOf("\n", w.from - 1) + 1;
  if (masked.slice(lineStart, w.from).trim() === "") {
    const entry = MONGO_KEYWORD_DOCS[w.text];
    if (entry) return { entry, from: w.from, to: w.to };
  }
  return null;
};
