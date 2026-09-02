import { useEffect, useRef, useState } from "react";
import { Accordion } from "@/shared/components/ui/accordion";
import { applySchemaOps, type TableSchema } from "@/shared/api";
import { useStudioStore, type SchemaEditHandle } from "@/shared/store";
import {
  build_index_ops,
  idx_is_dirty,
  idxs_from_schema,
  type IdxDraft,
  IndexesPanel,
} from "@/features/schema-designer";

/** Index list/create/drop editor for a MongoDB collection — reuses the SQL
 *  schema designer's `IndexesPanel`/draft machinery (indexes are the one DDL
 *  concept MongoDB shares with SQL tables; columns/triggers/FKs don't apply,
 *  so this skips the rest of `SchemaTab`). Registers its Apply/Discard
 *  through the same `schemaEdit` store slot the SQL schema tab uses, so the
 *  action bar's Apply/Discard controls work identically for both. */
export function MongoIndexesEditor({
  conn_id,
  collection,
  schema,
  store_key,
  on_applied,
}: {
  conn_id: string;
  collection: string;
  schema: TableSchema;
  /** The pane's tab key — matches the key `usePaneMode`/`gridBridges` use,
   *  so the action bar's dirty-tab tracking picks this up automatically. */
  store_key: string;
  /** Called after a successful Apply so the pane can refetch the schema. */
  on_applied: () => void;
}) {
  // Reset drafts whenever a NEW schema object arrives (initial load, or a
  // post-Apply reload) — identity comparison, same pattern as SchemaEditor.
  const [loaded_schema, setLoadedSchema] = useState(schema);
  const [idxs, setIdxs] = useState<IdxDraft[]>(() => idxs_from_schema(schema));
  const [applying, setApplying] = useState(false);

  if (loaded_schema !== schema) {
    setLoadedSchema(schema);
    setIdxs(idxs_from_schema(schema));
  }

  const dirty = idxs.some((ix) => idx_is_dirty(ix, (n) => n));
  const ops = dirty ? build_index_ops(collection, idxs, (n) => n) : [];

  const push_notification = useStudioStore((s) => s.pushNotification);
  const setSchemaEdit = useStudioStore((s) => s.setSchemaEdit);
  const clearSchemaEdit = useStudioStore((s) => s.clearSchemaEdit);

  const discard = () => setIdxs(idxs_from_schema(schema));

  const do_apply = async () => {
    if (applying || ops.length === 0) return;
    setApplying(true);
    try {
      const ran = await applySchemaOps(conn_id, ops);
      push_notification({
        kind: "success",
        title: `Indexes updated — ${ran.length} statement${ran.length === 1 ? "" : "s"} applied`,
        detail: ran.join("\n"),
      });
      on_applied();
    } catch (e) {
      push_notification({
        kind: "error",
        title: "Index changes failed",
        detail: `${String(e)}\n\nAttempted operations:\n${ops
          .map((o) => JSON.stringify(o))
          .join("\n")}`,
      });
    } finally {
      setApplying(false);
    }
  };

  const apply_ref = useRef(do_apply);
  const discard_ref = useRef(discard);
  useEffect(() => {
    apply_ref.current = do_apply;
    discard_ref.current = discard;
  });

  useEffect(() => {
    if (!dirty) return;
    const handle: SchemaEditHandle = {
      count: ops.length,
      busy: applying,
      apply: () => apply_ref.current(),
      discard: () => discard_ref.current(),
    };
    setSchemaEdit(store_key, handle);
    return () => clearSchemaEdit(store_key);
  }, [store_key, dirty, ops.length, applying, setSchemaEdit, clearSchemaEdit]);

  return (
    <Accordion multiple defaultValue={["indexes"]} className="space-y-2">
      <IndexesPanel
        idxs={idxs}
        columns={schema.columns.map((c) => c.name)}
        resolve_col={(n) => n}
        disabled={applying}
        on_update={(id, patch) =>
          setIdxs((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)))
        }
        on_replace={setIdxs}
      />
    </Accordion>
  );
}
