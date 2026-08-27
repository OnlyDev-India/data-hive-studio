import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Accordion } from "@/shared/components/ui/accordion";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { applySchemaOps, tableSchema, type TableSchema } from "@/shared/api";
import {
  useStudioStore,
  type SchemaEditHandle,
  type SchemaPaneHandle,
} from "@/shared/store";
import {
  build_ops,
  col_is_dirty,
  cols_from_schema,
  fk_is_dirty,
  fks_from_schema,
  idx_is_dirty,
  idxs_from_schema,
  pk_from_schema,
  trig_is_dirty,
  trigs_from_schema,
  validate_drafts,
  type ColDraft,
  type FkDraft,
  type IdxDraft,
  type TriggerDraft,
} from "./drafts";
import { ColumnsPanel } from "./columns-panel";
import { IndexesPanel } from "./indexes-panel";
import { ForeignKeysPanel } from "./foreign-keys-panel";
import { TriggersPanel } from "./triggers-panel";
import { DropTableDialog } from "./drop-table-dialog";

interface SchemaTabProps {
  conn_id: string;
  table: string;
  /** Store key of the owning pane — where the Apply handle is registered. */
  store_key: string;
  on_modified: () => void;
  /** Called after a successful Apply — the pane uses it to jump back to
   *  Data so the user sees refreshed rows immediately. */
  on_applied?: () => void;
}

export function SchemaTab({
  conn_id,
  table,
  store_key,
  on_modified,
  on_applied,
}: SchemaTabProps) {
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [load_error, setLoadError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await tableSchema(conn_id, table);
        if (!cancelled) {
          setSchema(s);
          setLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setSchema(null);
          setLoadError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, table, rev]);

  if (schema === null) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
        {load_error && (
          <div className="border-destructive bg-destructive/10 wrap-break-words text-destructive rounded-md border px-3 py-2 font-mono text-xs">
            {load_error}
          </div>
        )}
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
    );
  }

  return (
    <SchemaEditor
      conn_id={conn_id}
      table={table}
      schema={schema}
      store_key={store_key}
      on_modified={on_modified}
      on_applied={on_applied}
      on_refresh={() => setRev((r) => r + 1)}
    />
  );
}

interface SchemaEditorProps {
  conn_id: string;
  table: string;
  schema: TableSchema;
  store_key: string;
  on_modified: () => void;
  on_applied?: () => void;
  on_refresh: () => void;
}

/** Owns the draft state (columns / indexes / table name), the Apply pipeline
 *  and the action-bar Apply/Discard registration. */
function SchemaEditor({
  conn_id,
  table,
  schema,
  store_key,
  on_modified,
  on_applied,
  on_refresh,
}: SchemaEditorProps) {
  // Reset the drafts whenever a NEW schema object arrives (initial load,
  // Refresh click, or post-Apply reload). Identity comparison is deliberate:
  // keying off a revision counter would race — the counter changes before the
  // fresh schema has been fetched, so the drafts would be rebuilt from the
  // STALE schema and newly applied DDL (e.g. a created index) never appeared.
  const [loaded_schema, setLoaded_schema] = useState(schema);
  const [cols, setCols] = useState<ColDraft[]>(() => cols_from_schema(schema));
  const [idxs, setIdxs] = useState<IdxDraft[]>(() => idxs_from_schema(schema));
  const [trigs, setTrigs] = useState<TriggerDraft[]>(() =>
    trigs_from_schema(schema),
  );
  const [fks, setFks] = useState<FkDraft[]>(() => fks_from_schema(schema));
  /** PK columns as loaded — the draft flags diff against this. */
  const [orig_pk, setOrig_pk] = useState<string[]>(() => pk_from_schema(cols));
  const [table_name, setTable_name] = useState(table);
  const [editing_name, setEditing_name] = useState(false);
  const [applying, setApplying] = useState(false);

  if (loaded_schema !== schema) {
    setLoaded_schema(schema);
    setCols(cols_from_schema(schema));
    setIdxs(idxs_from_schema(schema));
    setTrigs(trigs_from_schema(schema));
    setFks(fks_from_schema(schema));
    setOrig_pk(pk_from_schema(cols_from_schema(schema)));
    setTable_name(table);
    setEditing_name(false);
  }

  const rename_map = new Map<string, string>(
    cols
      .filter((c) => !c.dropped && c.orig_name && c.name.trim() !== c.orig_name)
      .map((c) => [c.orig_name as string, c.name.trim()]),
  );
  const resolve_col = (n: string) => rename_map.get(n) ?? n;

  const current_pk = cols
    .filter((c) => !c.dropped && c.primary_key)
    .map((c) => resolve_col(c.name.trim()));
  const pk_changed = JSON.stringify(current_pk) !== JSON.stringify(orig_pk);

  const dirty =
    table_name.trim() !== table ||
    cols.some(col_is_dirty) ||
    idxs.some((ix) => idx_is_dirty(ix, resolve_col)) ||
    trigs.some(trig_is_dirty) ||
    pk_changed ||
    fks.some(fk_is_dirty);

  const update_col = (id: string, patch: Partial<ColDraft>) => {
    setCols((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const update_idx = (id: string, patch: Partial<IdxDraft>) => {
    setIdxs((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const update_trig = (id: string, patch: Partial<TriggerDraft>) => {
    setTrigs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const discard = () => {
    setCols(cols_from_schema(schema));
    setIdxs(idxs_from_schema(schema));
    setTrigs(trigs_from_schema(schema));
    setFks(fks_from_schema(schema));
    setOrig_pk(pk_from_schema(cols_from_schema(schema)));
    setTable_name(table);
  };

  // Apply results (success AND failure) are reported through the action-bar
  // notification center — the schema tab itself stays clean and editable.
  const push_notification = useStudioStore((s) => s.pushNotification);

  const do_apply = async () => {
    if (applying) return;
    const problem = validate_drafts(table_name, cols, idxs, trigs, fks);
    if (problem) {
      push_notification({
        kind: "error",
        title: "Schema changes blocked",
        detail: problem,
      });
      return;
    }
    const ops = build_ops(
      table,
      table_name.trim(),
      cols,
      idxs,
      resolve_col,
      trigs,
      fks,
      orig_pk.map(resolve_col),
    );
    if (ops.length === 0) {
      discard();
      return;
    }
    setApplying(true);
    try {
      const ran = await applySchemaOps(conn_id, ops);
      push_notification({
        kind: "success",
        title: `Schema updated — ${ran.length} statement${ran.length === 1 ? "" : "s"} applied`,
        detail: ran.join("\n"),
      });
      on_modified();
      on_refresh();
      // Jump back to Data so refreshed rows are visible immediately (the
      // grid shows its own loading overlay during that fetch).
      on_applied?.();
    } catch (e) {
      push_notification({
        kind: "error",
        title: "Schema changes failed — rolled back",
        detail: `${String(e)}\n\nAttempted operations:\n${ops
          .map((o) => JSON.stringify(o))
          .join("\n")}`,
      });
    } finally {
      setApplying(false);
    }
  };

  // Publish Apply/Discard to the status bar while drafts are dirty, and
  // always publish Refresh / Drop-table while the schema editor is open
  // (same registration pattern Grid uses for its bridge).
  const setSchemaEdit = useStudioStore((s) => s.setSchemaEdit);
  const clearSchemaEdit = useStudioStore((s) => s.clearSchemaEdit);
  const setSchemaPane = useStudioStore((s) => s.setSchemaPane);
  const clearSchemaPane = useStudioStore((s) => s.clearSchemaPane);
  const [confirm_drop, setConfirm_drop] = useState(false);
  const pending_count = dirty
    ? build_ops(
        table,
        table_name.trim(),
        cols,
        idxs,
        resolve_col,
        trigs,
        fks,
        orig_pk.map(resolve_col),
      ).length
    : 0;
  const apply_ref = useRef(do_apply);
  const discard_ref = useRef(discard);
  const refresh_ref = useRef(on_refresh);

  // Keep the latest handlers reachable from the registration effects without
  // re-registering on every keystroke (mutating refs during render is not
  // allowed by the react-hooks rules, so this runs as an effect).
  useEffect(() => {
    apply_ref.current = do_apply;
    discard_ref.current = discard;
    refresh_ref.current = on_refresh;
  });

  useEffect(() => {
    if (!dirty) return;
    const handle: SchemaEditHandle = {
      count: pending_count,
      busy: applying,
      apply: () => apply_ref.current(),
      discard: () => discard_ref.current(),
    };
    setSchemaEdit(store_key, handle);
    return () => clearSchemaEdit(store_key);
  }, [
    store_key,
    dirty,
    pending_count,
    applying,
    setSchemaEdit,
    clearSchemaEdit,
  ]);

  useEffect(() => {
    const handle: SchemaPaneHandle = {
      busy: applying,
      refresh: () => refresh_ref.current(),
      drop: () => setConfirm_drop(true),
    };
    setSchemaPane(store_key, handle);
    return () => clearSchemaPane(store_key);
  }, [store_key, applying, setSchemaPane, clearSchemaPane]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-4">
          {/* Refresh + Drop table live in the status bar (SchemaPaneHandle);
              only the confirm dialog stays mounted here. While an Apply is
              in flight every editor control is locked. */}
          <TableNameHeading
            table_name={table_name}
            editing={editing_name}
            disabled={applying}
            on_toggle_edit={() => setEditing_name((v) => !v)}
            on_change={(v) => setTable_name(v)}
            on_cancel={() => {
              setTable_name(table);
              setEditing_name(false);
            }}
          />

          {applying && (
            <div className="border-primary/30 bg-primary/5 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
              <Loader2 className="text-primary size-3.5 animate-spin" />
              Applying {pending_count} change{pending_count === 1 ? "" : "s"} in
              one transaction…
            </div>
          )}

          <Accordion
            multiple
            defaultValue={["columns"]}
            className={"space-y-2"}
          >
            <ColumnsPanel
              cols={cols}
              disabled={applying}
              on_update={update_col}
              on_replace={setCols}
            />
            <IndexesPanel
              idxs={idxs}
              columns={cols.filter((c) => !c.dropped).map((c) => c.name.trim())}
              resolve_col={resolve_col}
              disabled={applying}
              on_update={update_idx}
              on_replace={setIdxs}
            />
            <ForeignKeysPanel
              conn_id={conn_id}
              fks={fks}
              columns={cols.filter((c) => !c.dropped).map((c) => c.name.trim())}
              disabled={applying}
              on_update={(id, patch) =>
                setFks((fs) =>
                  fs.map((f) => (f.id === id ? { ...f, ...patch } : f)),
                )
              }
              on_replace={setFks}
            />
            <TriggersPanel
              trigs={trigs}
              disabled={applying}
              on_update={update_trig}
              on_replace={setTrigs}
            />
          </Accordion>
        </div>
      </div>

      <DropTableDialog
        conn_id={conn_id}
        table={table}
        open={confirm_drop}
        on_open_change={setConfirm_drop}
        on_dropped={on_modified}
      />
    </div>
  );
}

/** Table title with inline rename editor (pencil → input + confirm/cancel). */
function TableNameHeading({
  table_name,
  editing,
  disabled = false,
  on_toggle_edit,
  on_change,
  on_cancel,
}: {
  table_name: string;
  editing: boolean;
  disabled?: boolean;
  on_toggle_edit: () => void;
  on_change: (v: string) => void;
  on_cancel: () => void;
}) {
  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="truncate text-base font-semibold">
          {table_name || "(unnamed)"}
        </h2>
        <Button
          variant="ghost"
          size="iconXs"
          aria-label="Rename table"
          title="Rename table"
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
        value={table_name}
        disabled={disabled}
        onChange={(e) => on_change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") on_toggle_edit();
          else if (e.key === "Escape") on_cancel();
        }}
        placeholder="table name"
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
