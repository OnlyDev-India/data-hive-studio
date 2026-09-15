import { completeFromList, snippetCompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { tableSchema } from "@/shared/api";

/** An operator/stage completion that inserts a snippet — `${}`/`${name}`
 *  tab stops so accepting `$and` drops in `$and: [{ }]` with the cursor
 *  already inside the array's first condition, ready to keep typing, rather
 *  than just the bare key text the user would then have to hand-build the
 *  value shape for. */
function op(label: string, template: string, detail?: string): Completion {
  return snippetCompletion(template, { label, type: "keyword", detail });
}

/** Shell methods offered right after `db.<collection>.` — NEVER mixed into
 *  the collection-name list itself (see `nosqlConsoleCompletions`): typing
 *  `db.` should only ever narrow down which collection you mean. */
export const NOSQL_SHELL_COMPLETIONS: Completion[] = [
  { label: "find", type: "method" },
  { label: "findOne", type: "method" },
  { label: "countDocuments", type: "method" },
  { label: "count", type: "method" },
  { label: "distinct", type: "method" },
  { label: "aggregate", type: "method" },
  { label: "insertOne", type: "method" },
  { label: "insertMany", type: "method" },
  { label: "updateOne", type: "method" },
  { label: "updateMany", type: "method" },
  { label: "deleteOne", type: "method" },
  { label: "deleteMany", type: "method" },
  { label: "sort", type: "method" },
  { label: "limit", type: "method" },
  { label: "skip", type: "method" },
  { label: "pretty", type: "method" },
];

/** Database-level methods — valid right after bare `db.`, alongside (not
 *  instead of) collection names. Distinct from `NOSQL_SHELL_COMPLETIONS`,
 *  which are collection methods (`db.<collection>.find(...)`); `aggregate`
 *  also has a database-level form for pipelines that don't start from a
 *  collection (`$currentOp`, `$listSessions`, a literal `$documents` stage). */
const DB_LEVEL_METHODS: Completion[] = [
  { label: "aggregate", type: "method", detail: "database-level" },
];

/** Shell keywords offered anywhere (`use analytics`, `show collections`, …). */
const SHELL_KEYWORDS: Completion[] = [
  { label: "use", type: "keyword" },
  { label: "show dbs", type: "keyword" },
  { label: "show collections", type: "keyword" },
];

/** Logical operators valid as a KEY at the top of a filter document. */
const TOP_LEVEL_OPERATORS: Completion[] = [
  op("$and", "$and: [{ ${} }]", "logical AND"),
  op("$or", "$or: [{ ${} }]", "logical OR"),
  op("$nor", "$nor: [{ ${} }]", "logical NOR"),
  op("$expr", "$expr: { ${} }", "aggregation expression"),
];

/** Comparison/element operators valid as a KEY inside a field's condition
 *  object, e.g. `{ age: { $gt: ... } }`. */
const FIELD_OPERATORS: Completion[] = [
  op("$eq", "$eq: ${}"),
  op("$ne", "$ne: ${}"),
  op("$gt", "$gt: ${}"),
  op("$gte", "$gte: ${}"),
  op("$lt", "$lt: ${}"),
  op("$lte", "$lte: ${}"),
  op("$in", "$in: [${}]"),
  op("$nin", "$nin: [${}]"),
  op("$exists", "$exists: ${true}"),
  op("$regex", '$regex: "${}"'),
  op("$type", '$type: "${}"'),
  op("$size", "$size: ${}"),
  op("$all", "$all: [${}]"),
  op("$elemMatch", "$elemMatch: { ${} }"),
  op("$mod", "$mod: [${divisor}, ${remainder}]"),
  op("$not", "$not: { ${} }"),
];

/** Aggregation pipeline stage names — valid as the (single) key of each
 *  stage object in an `aggregate([...])` pipeline array. */
const AGGREGATION_STAGES: Completion[] = [
  op("$match", "$match: { ${} }"),
  op("$group", "$group: { _id: ${}, ${} }"),
  op("$project", "$project: { ${} }"),
  op("$sort", "$sort: { ${} }"),
  op("$limit", "$limit: ${}"),
  op("$skip", "$skip: ${}"),
  op("$unwind", '$unwind: "$${}"'),
  op(
    "$lookup",
    '$lookup: { from: "${}", localField: "${}", foreignField: "${}", as: "${}" }',
  ),
  op("$addFields", "$addFields: { ${} }"),
  op("$set", "$set: { ${} }"),
  op("$unset", '$unset: "${}"'),
  op("$count", '$count: "${}"'),
  op("$facet", "$facet: { ${} }"),
  op("$bucket", "$bucket: { ${} }"),
  op("$replaceRoot", "$replaceRoot: { newRoot: ${} }"),
  op("$sample", "$sample: { size: ${} }"),
  op("$out", '$out: "${}"'),
  op("$merge", '$merge: { into: "${}" }'),
];

/** Update operators — valid as a top-level key of an update document, e.g.
 *  `updateOne(filter, { $set: { ... } })`. */
const UPDATE_OPERATORS: Completion[] = [
  op("$set", "$set: { ${} }"),
  op("$unset", "$unset: { ${} }"),
  op("$inc", "$inc: { ${field}: ${1} }"),
  op("$mul", "$mul: { ${field}: ${1} }"),
  op("$min", "$min: { ${field}: ${} }"),
  op("$max", "$max: { ${field}: ${} }"),
  op("$push", "$push: { ${field}: ${} }"),
  op("$pull", "$pull: { ${field}: ${} }"),
  op("$addToSet", "$addToSet: { ${field}: ${} }"),
  op("$pop", "$pop: { ${field}: ${1} }"),
  op("$rename", '$rename: { ${field}: "${newName}" }'),
  op("$currentDate", "$currentDate: { ${field}: true }"),
];

/** First argument is a filter document (fields + $and/$or/$nor at the top,
 *  $gt/$lt/… one level inside a field's condition). */
const FILTER_METHODS = new Set([
  "find",
  "findOne",
  "count",
  "countDocuments",
  "deleteOne",
  "deleteMany",
  "distinct",
]);
/** First argument is a filter (like above); second is an update document
 *  ($set/$inc/… at the top, then field names one level inside each). */
const UPDATE_METHODS = new Set([
  "updateOne",
  "updateMany",
  "replaceOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
]);
/** First argument is a literal document to insert — field names only, no
 *  query operators (there's nothing to compare against yet). */
const INSERT_METHODS = new Set(["insertOne", "insertMany"]);

// ---- per-collection field-name cache ---------------------------------------
// Shared across every Mongo console tab in the session (same idea as
// sql-tab.tsx's schema_cache) — a second tab, or reopening one, costs zero
// extra schema round trips. Keyed by connection + collection since the same
// collection name can exist on different connections.
const fieldCache = new Map<string, Completion[]>();
const fieldFetches = new Map<string, Promise<Completion[]>>();

function fetchFields(
  connId: string,
  collection: string,
): Promise<Completion[]> {
  const key = `${connId}\u0000${collection}`;
  const cached = fieldCache.get(key);
  if (cached) return Promise.resolve(cached);
  let pending = fieldFetches.get(key);
  if (!pending) {
    pending = tableSchema(connId, collection)
      .then((s) => {
        const cols: Completion[] = s.columns.map((c) => ({
          label: c.name,
          type: "property",
          detail: c.data_type,
        }));
        fieldCache.set(key, cols);
        return cols;
      })
      .catch(() => [] as Completion[])
      .finally(() => {
        fieldFetches.delete(key);
      });
    fieldFetches.set(key, pending);
  }
  return pending;
}

// ---- lightweight bracket/argument scanner ----------------------------------
// Not a full JSON/JS parser — just enough to know, at the cursor, which
// db.<collection>.<method>(...) call we're inside, how deep into {}/[] we
// are, which top-level argument we're in (comma count at depth 0), and
// whether we're mid-key or mid-string. Good enough for the REPL-style,
// single-statement lines this console is actually used with.
interface ArgsScan {
  stack: Array<"{" | "[">;
  argIndex: number;
  lastSep: "{" | "[" | "," | ":" | null;
  inString: boolean;
  stringStart: number;
}

function scanArgs(text: string, end: number): ArgsScan {
  let inString = false;
  let stringStart = -1;
  const stack: Array<"{" | "["> = [];
  let lastSep: ArgsScan["lastSep"] = null;
  let argIndex = 0;
  let i = 0;
  while (i < end) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        inString = false;
        stringStart = -1;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      stringStart = i;
      i++;
      continue;
    }
    if (c === "{" || c === "[") {
      stack.push(c);
      lastSep = c;
      i++;
      continue;
    }
    if (c === "}" || c === "]") {
      stack.pop();
      lastSep = null;
      i++;
      continue;
    }
    if (c === ",") {
      if (stack.length === 0) argIndex++;
      lastSep = ",";
      i++;
      continue;
    }
    if (c === ":") {
      lastSep = ":";
      i++;
      continue;
    }
    i++;
  }
  return { stack, argIndex, lastSep, inString, stringStart };
}

/** The partial identifier (bareword) or string content typed so far right
 *  before `pos`, and where a replacement should start. Works whether the key
 *  is bareword (`{na`) or already inside an open quote (`{"na`) — either
 *  way `closeBrackets` has usually already placed the matching quote, so
 *  completion just fills the content between the quotes. */
function currentPrefix(
  text: string,
  pos: number,
  scan: ArgsScan,
): { prefix: string; from: number } {
  if (scan.inString) {
    return {
      prefix: text.slice(scan.stringStart + 1, pos),
      from: scan.stringStart + 1,
    };
  }
  const m = /[\w$]*$/.exec(text.slice(0, pos));
  const prefix = m ? m[0] : "";
  return { prefix, from: pos - prefix.length };
}

function findMongoCall(
  before: string,
): { collection: string; method: string; argsStart: number } | null {
  const re = /db\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(before))) last = m;
  if (!last) return null;
  return {
    collection: last[1],
    method: last[2],
    argsStart: last.index + last[0].length,
  };
}

async function filterKeyOptions(
  connId: string,
  collection: string,
  depth: number,
  includeOperators: boolean,
): Promise<Completion[]> {
  if (depth <= 1) {
    const fields = await fetchFields(connId, collection);
    return includeOperators ? [...fields, ...TOP_LEVEL_OPERATORS] : fields;
  }
  if (depth === 2 && includeOperators) return FIELD_OPERATORS;
  return [];
}

/** Key-position suggestions inside a db.<collection>.<method>(...) call's
 *  arguments: field names (from the collection's inferred schema) and the
 *  operators appropriate to where the cursor sits — $and/$or/$nor at a
 *  filter's top level, $gt/$lt/$in/… one level inside a field's condition,
 *  aggregation stage names as pipeline-stage keys, $set/$inc/… at an update
 *  document's top level. Returns null outside of a recognized key position
 *  (values are user data — nothing to suggest there). */
function queryBodyCompletions(connId: string): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.state.doc.sliceString(0, ctx.pos);
    const call = findMongoCall(before);
    if (!call || call.argsStart > ctx.pos) return null;

    const argsText = before.slice(call.argsStart);
    const relPos = ctx.pos - call.argsStart;
    const scan = scanArgs(argsText, relPos);

    // Only a key position (right after `{`/`,`, or mid-way through typing
    // one) offers anything here.
    if (scan.lastSep !== "{" && scan.lastSep !== ",") return null;

    // `currentPrefix` works in argsText-local coordinates — offset back into
    // full-document coordinates for the CompletionResult.
    const { from: localFrom } = currentPrefix(argsText, relPos, scan);
    const from = call.argsStart + localFrom;
    let options: Completion[] = [];

    if (call.method === "aggregate") {
      if (
        scan.stack.length === 2 &&
        scan.stack[0] === "[" &&
        scan.stack[1] === "{"
      ) {
        // Key of a pipeline stage object: `{ $match: ... }`.
        options = AGGREGATION_STAGES;
      } else if (
        scan.stack.length >= 3 &&
        scan.stack[0] === "[" &&
        scan.stack[1] === "{"
      ) {
        // Inside a stage's own value — a filter-document shape one level
        // deeper (strip the pipeline `[` and the stage `{`).
        options = await filterKeyOptions(
          connId,
          call.collection,
          scan.stack.length - 2,
          true,
        );
      }
    } else if (INSERT_METHODS.has(call.method)) {
      options = await filterKeyOptions(
        connId,
        call.collection,
        scan.stack.length,
        false,
      );
    } else if (UPDATE_METHODS.has(call.method)) {
      if (scan.argIndex === 0) {
        options = await filterKeyOptions(
          connId,
          call.collection,
          scan.stack.length,
          true,
        );
      } else if (scan.argIndex === 1) {
        if (scan.stack.length === 1) options = UPDATE_OPERATORS;
        else if (scan.stack.length === 2)
          options = await fetchFields(connId, call.collection);
      }
    } else if (FILTER_METHODS.has(call.method)) {
      options = await filterKeyOptions(
        connId,
        call.collection,
        scan.stack.length,
        true,
      );
    }

    if (options.length === 0) return null;
    return { from, options, validFor: /^[\w$]*$/ };
  };
}

/** Completions for the Mongo console: right after `db.` this offers
 *  collection names PLUS database-level methods (currently just
 *  `aggregate` — collection methods like `find` only make sense once a
 *  collection's been chosen, so they're withheld here); right after
 *  `db.<collection>.` it offers ONLY (collection) shell methods; inside a
 *  call's arguments it delegates to `queryBodyCompletions` for
 *  field/operator suggestions; anything else falls back to prefix-matching
 *  the combined method/collection/keyword list (e.g. typing `use`,
 *  `show collections`). */
export function nosqlConsoleCompletions(
  connId: string,
  methods: Completion[],
  collections: Completion[],
): CompletionSource {
  const dbLevelOptions = [...collections, ...DB_LEVEL_METHODS];
  const shellFallback = completeFromList([
    ...methods,
    ...collections,
    ...SHELL_KEYWORDS,
  ]);
  const bodySource = queryBodyCompletions(connId);

  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const before = ctx.state.doc.sliceString(0, ctx.pos);

    // Right after `db.`, optionally with a partial name already typed —
    // collection names, plus database-level methods (`aggregate`). Built
    // directly (not via `completeFromList`, which needs at least one typed
    // word char to match — it would show nothing right after a bare `db.`).
    const collMatch = /db\.([\w$]*)$/.exec(before);
    if (collMatch) {
      return {
        from: ctx.pos - collMatch[1].length,
        options: dbLevelOptions,
        validFor: /^[\w$]*$/,
      };
    }

    // Right after `db.<collection>.` — shell methods ONLY.
    const methodMatch = /db\.[\w$]+\.([\w$]*)$/.exec(before);
    if (methodMatch) {
      return {
        from: ctx.pos - methodMatch[1].length,
        options: methods,
        validFor: /^[\w$]*$/,
      };
    }

    // Inside a call's arguments — context-dependent operators/fields.
    const body = await bodySource(ctx);
    if (body) return body;

    return shellFallback(ctx);
  };
}
