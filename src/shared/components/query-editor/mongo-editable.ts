import { singleTableSelect } from "./sql-editable";

/** `db.<collection>.find(...)` / `.findOne(...)`, optionally chained with
 *  `.sort()/.limit()/.skip()` — only these two methods return raw documents
 *  1:1 from a single collection, matchable by `_id`. Anything else
 *  (`aggregate`, `count`, `updateMany`, …) isn't a per-document view. */
const NATIVE_FIND = /^\s*db\.([A-Za-z_$][\w$]*)\.(find|findOne)\s*\(/;

/** Whether a Mongo console command is a single-collection, per-document
 *  view an edit can be mapped back onto — either native shell syntax
 *  (`db.coll.find(...)`) or this app's SQL-on-Mongo subset input (plain SQL
 *  text, translated by the backend's own narrower single-table grammar, so
 *  anything `singleTableSelect` accepts is safe to reuse here too). Returns
 *  the collection name on success, `null` otherwise. */
export function singleCollectionQuery(command: string): { table: string } | null {
  const native = NATIVE_FIND.exec(command);
  if (native) return { table: native[1] };
  return singleTableSelect(command);
}
