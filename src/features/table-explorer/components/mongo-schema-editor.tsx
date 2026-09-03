import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Accordion } from "@/shared/components/ui/accordion";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { applySchemaOps, type SchemaOp, type TableSchema } from "@/shared/api";
import {
  useStudioStore,
  type SchemaEditHandle,
  type SchemaPaneHandle,
} from "@/shared/store";
import {
  build_index_ops,
  idx_is_dirty,
  idxs_from_schema,
  type IdxDraft,
  IndexesPanel,
  DropTableDialog,
} from "@/features/schema-designer";

/** Schema editor for a MongoDB collection: rename + index list/create/drop.
 *  Reuses the SQL schema designer's `IndexesPanel`/draft machinery and
 *  `DropTableDialog` — rename and indexes are the two DDL concepts MongoDB
 *  shares with SQL tables; columns/triggers/FKs don't apply, so this skips
 *  the rest of `SchemaTab`. Registers Apply/Discard (schemaEdit) AND
 *  Refresh/Drop (schemaPane) through the same store slots the SQL schema tab
 *  uses, so the action bar's controls work identically for both. */
export function MongoSchemaEditor({
  conn_id,
  collection,
  schema,
  store_key,
  on_applied,
  on_dropped,
}: {
  conn_id: string;
  collection: string;
  schema: TableSchema;
  /** The pane's tab key — matches the key `usePaneMode`/`gridBridges` use,
   *  so the action bar's dirty-tab tracking picks this up automatically. */
  store_key: string;
  /** Called after a successful Apply so the pane can refetch the schema, and
   *  by a plain action-bar Refresh click. */
  on_applied: () => void;
  /** Called after the collection is dropped. */
  on_dropped: () => void;
}) {
  // Reset drafts whenever a NEW schema object arrives (initial load, or a
  // post-Apply reload) — identity comparison, same pattern as SchemaEditor.
  const [loaded_schema, setLoadedSchema] = useState(schema);
  const [idxs, setIdxs] = useState<IdxDraft[]>(() => idxs_from_schema(schema));
  const [collection_name, setCollectionName] = useState(collection);
  const [editing_name, setEditingName] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirm_drop, setConfirmDrop] = useState(false);

  if (loaded_schema !== schema) {
    setLoadedSchema(schema);
    setIdxs(idxs_from_schema(schema));
    setCollectionName(collection);
    setEditingName(false);
  }

  const trimmed_name = collection_name.trim();
  const name_changed = trimmed_name !== "" && trimmed_name !== collection;
  const dirty = name_changed || idxs.some((ix) => idx_is_dirty(ix, (n) => n));
  // Rename first (mirrors the SQL SchemaEditor's op order) so the index ops
  // that follow target the collection under its FINAL name.
  const target_name = name_changed ? trimmed_name : collection;
  const ops: SchemaOp[] = dirty
    ? [
        ...(name_changed
          ? [
              {
                kind: "rename_table" as const,
                table: collection,
                new_name: target_name,
              },
            ]
          : []),
        ...build_index_ops(target_name, idxs, (n) => n),
      ]
    : [];

  const push_notification = useStudioStore((s) => s.pushNotification);
  const setSchemaEdit = useStudioStore((s) => s.setSchemaEdit);
  const clearSchemaEdit = useStudioStore((s) => s.clearSchemaEdit);
  const setSchemaPane = useStudioStore((s) => s.setSchemaPane);
  const clearSchemaPane = useStudioStore((s) => s.clearSchemaPane);

  const discard = () => {
    setIdxs(idxs_from_schema(schema));
    setCollectionName(collection);
    setEditingName(false);
  };

  const do_apply = async () => {
    if (applying || ops.length === 0) return;
    setApplying(true);
    try {
      const ran = await applySchemaOps(conn_id, ops);
      push_notification({
        kind: "success",
        title: `Collection updated — ${ran.length} statement${ran.length === 1 ? "" : "s"} applied`,
        detail: ran.join("\n"),
      });
      on_applied();
    } catch (e) {
      push_notification({
        kind: "error",
        title: "Collection changes failed",
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

  // Refresh / Drop stay registered regardless of dirty state — same as the
  // SQL schema tab's always-on status-bar tools.
  const refresh_ref = useRef(on_applied);
  useEffect(() => {
    refresh_ref.current = on_applied;
  });
  useEffect(() => {
    const handle: SchemaPaneHandle = {
      busy: applying,
      refresh: () => refresh_ref.current(),
      drop: () => setConfirmDrop(true),
    };
    setSchemaPane(store_key, handle);
    return () => clearSchemaPane(store_key);
  }, [store_key, applying, setSchemaPane, clearSchemaPane]);

  return (
    <div className="flex flex-col gap-3">
      <CollectionNameHeading
        name={collection_name}
        editing={editing_name}
        disabled={applying}
        on_toggle_edit={() => setEditingName((v) => !v)}
        on_change={setCollectionName}
        on_cancel={() => {
          setCollectionName(collection);
          setEditingName(false);
        }}
      />

      <Accordion multiple defaultValue={["indexes"]} className="space-y-2">
        <IndexesPanel
          idxs={idxs}
          columns={schema.columns.map((c) => c.name)}
          resolve_col={(n) => n}
          disabled={applying}
          mongo
          on_update={(id, patch) =>
            setIdxs((xs) =>
              xs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
            )
          }
          on_replace={setIdxs}
        />
      </Accordion>

      <DropTableDialog
        conn_id={conn_id}
        table={collection}
        object_noun="collection"
        open={confirm_drop}
        on_open_change={setConfirmDrop}
        on_dropped={on_dropped}
      />
    </div>
  );
}

/** Collection name with inline rename editor (pencil → input + confirm/cancel),
 *  matching the SQL schema tab's `TableNameHeading`. */
function CollectionNameHeading({
  name,
  editing,
  disabled = false,
  on_toggle_edit,
  on_change,
  on_cancel,
}: {
  name: string;
  editing: boolean;
  disabled?: boolean;
  on_toggle_edit: () => void;
  on_change: (v: string) => void;
  on_cancel: () => void;
}) {
  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="truncate text-sm font-medium">{name || "(unnamed)"}</h3>
        <Button
          variant="ghost"
          size="iconXs"
          aria-label="Rename collection"
          title="Rename collection"
          disabled={disabled}
          onClick={on_toggle_edit}
        >
          <Pencil className="size-3.5" />
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={name}
        disabled={disabled}
        onChange={(e) => on_change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") on_toggle_edit();
          else if (e.key === "Escape") on_cancel();
        }}
        placeholder="collection name"
        className="h-8 max-w-xs"
      />
      <Button
        size="iconXs"
        aria-label="Done"
        disabled={disabled}
        onClick={on_toggle_edit}
      >
        <Check className="size-3.5" />
      </Button>
      <Button
        size="iconXs"
        variant="ghost"
        aria-label="Cancel"
        disabled={disabled}
        onClick={on_cancel}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
