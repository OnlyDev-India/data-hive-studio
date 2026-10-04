/** A stage operator the add menu offers, with the body a new card starts
 *  with. Anything else can still be typed into a card. */
export interface Operator {
  op: string;
  description: string;
  template: string;
}

export const OPERATORS: Operator[] = [
  {
    op: "$match",
    description: "Keep the documents that match a filter",
    template: "{}",
  },
  {
    op: "$project",
    description: "Pick, drop or compute fields",
    template: "{ _id: 1 }",
  },
  {
    op: "$addFields",
    description: "Add computed fields, keeping the rest",
    template: '{ newField: "$field" }',
  },
  {
    op: "$set",
    description: "Same as $addFields",
    template: '{ newField: "$field" }',
  },
  { op: "$unset", description: "Remove fields", template: '"field"' },
  {
    op: "$group",
    description: "Group documents by a key and aggregate them",
    template: '{ _id: "$field", count: { $sum: 1 } }',
  },
  {
    op: "$sort",
    description: "Order documents by one or more fields",
    template: "{ _id: 1 }",
  },
  { op: "$limit", description: "Keep the first N documents", template: "10" },
  { op: "$skip", description: "Skip the first N documents", template: "10" },
  {
    op: "$unwind",
    description: "One document per element of an array",
    template: '"$field"',
  },
  {
    op: "$lookup",
    description: "Join documents from another collection",
    template:
      '{ from: "collection", localField: "field", foreignField: "_id", as: "joined" }',
  },
  {
    op: "$count",
    description: "Count the documents into one field",
    template: '"count"',
  },
  {
    op: "$sortByCount",
    description: "Group by a value and sort by how often it appears",
    template: '"$field"',
  },
  {
    op: "$replaceRoot",
    description: "Make an embedded document the new root",
    template: '{ newRoot: "$field" }',
  },
  {
    op: "$replaceWith",
    description: "Same as $replaceRoot, shorter",
    template: '"$field"',
  },
  {
    op: "$facet",
    description: "Run several pipelines on the same input",
    template: "{ output: [{ $limit: 10 }] }",
  },
  {
    op: "$bucket",
    description: "Group into ranges you choose",
    template: '{ groupBy: "$field", boundaries: [0, 100], default: "other" }',
  },
  {
    op: "$bucketAuto",
    description: "Group into evenly sized ranges",
    template: '{ groupBy: "$field", buckets: 5 }',
  },
  {
    op: "$sample",
    description: "Pick N documents at random",
    template: "{ size: 10 }",
  },
  {
    op: "$unionWith",
    description: "Append the documents of another collection",
    template: '{ coll: "collection", pipeline: [] }',
  },
  {
    op: "$graphLookup",
    description: "Follow references recursively",
    template:
      '{ from: "collection", startWith: "$field", connectFromField: "field", connectToField: "_id", as: "graph" }',
  },
  {
    op: "$setWindowFields",
    description: "Compute values over a window of documents",
    template: "{ sortBy: { _id: 1 }, output: { rank: { $rank: {} } } }",
  },
  {
    op: "$densify",
    description: "Fill gaps in a sequence of values",
    template: '{ field: "field", range: { step: 1, bounds: "full" } }',
  },
  {
    op: "$fill",
    description: "Fill missing or null field values",
    template: "{ output: { field: { value: 0 } } }",
  },
  {
    op: "$redact",
    description: "Keep or prune parts of documents by a condition",
    template: '{ $cond: { if: true, then: "$$KEEP", else: "$$PRUNE" } }',
  },
  {
    op: "$geoNear",
    description: "Order by distance from a point (must be first)",
    template:
      '{ near: { type: "Point", coordinates: [0, 0] }, distanceField: "distance" }',
  },
  {
    op: "$search",
    description: "Atlas Search full text query (must be first)",
    template: '{ text: { query: "word", path: "field" } }',
  },
  {
    op: "$out",
    description: "Write the result to a collection, replacing it",
    template: '"collection"',
  },
  {
    op: "$merge",
    description: "Merge the result into a collection",
    template: '{ into: "collection" }',
  },
];

const BY_OP = new Map(OPERATORS.map((o) => [o.op, o]));

export function operatorOf(op: string): Operator | undefined {
  return BY_OP.get(op);
}

/** Stages that write and so are never previewed. */
export function isWriteOp(op: string): boolean {
  return op === "$out" || op === "$merge";
}
