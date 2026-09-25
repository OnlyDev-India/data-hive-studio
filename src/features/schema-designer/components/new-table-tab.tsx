import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Plus,
  Search,
  SquareArrowOutUpRight,
  Upload,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  catalogOverview,
  listSchemaObjects,
  listSchemasIn,
  runSql,
  tableSchema,
} from "@/shared/api";
import { useStudioStore } from "@/shared/store";
import { QueryEditor } from "@/features/query-editor";
import { ColumnsGrid } from "./new-table/columns-grid";
import { ConstraintsGrid } from "./new-table/constraints-grid";
import { CopyFieldsDialog } from "./new-table/copy-fields-dialog";
import { ForeignKeysGrid } from "./new-table/foreign-keys-grid";
import { IndexesGrid } from "./new-table/indexes-grid";
import {
  buildCreate,
  defaultColumn,
  newColumn,
  newConstraint,
  newFk,
  newIndex,
  type ColumnDef,
  type ConstraintDef,
  type FkDef,
  type IndexDef,
  type RefTableMeta,
} from "./new-table/model";
import { TabBar, type DesignerTab } from "./new-table/tab-bar";

interface NewTableTabProps {
  conn_id: string;
  /** Store key this tab registers its Create action under. */
  tab_key: string;
  /** True when this tab is the visible one — the action-bar Create button
   *  is registered only for the active new-table tab. */
  active: boolean;
  on_modified: () => void;
  on_created: (name: string, database?: string, schema?: string) => void;
}

export function NewTableTab({
  conn_id,
  tab_key,
  active,
  on_modified,
  on_created,
}: NewTableTabProps) {
  const [table_name, setTableName] = useState("");
  const [columns, setColumns] = useState<ColumnDef[]>([defaultColumn()]);
  const [fks, setFks] = useState<FkDef[]>([]);
  const [indexes, setIndexes] = useState<IndexDef[]>([]);
  const [constraints, setConstraints] = useState<ConstraintDef[]>([]);
  const [tab, setTab] = useState<DesignerTab>("columns");
  const [query, setQuery] = useState("");
  const [copying, setCopying] = useState(false);
  const [creating, setCreating] = useState(false);
  // Referencable tables + their columns (fetched lazily per selected table so
  // the FK rows can offer real pickers instead of free-text inputs).
  const [table_names, setTableNames] = useState<string[]>([]);
  const [ref_meta, setRefMeta] = useState<Record<string, RefTableMeta>>({});
  const push_notification = useStudioStore((s) => s.pushNotification);
  const setNewTable = useStudioStore((s) => s.setNewTable);
  const clearNewTable = useStudioStore((s) => s.clearNewTable);
  const openImport = useStudioStore((s) => s.openImport);

  // ---- Target database/schema (Postgres only — SQLite has neither
  // concept within one connection, and Mongo creates collections through
  // its own MongoNewCollectionTab). Defaults to the connection's own
  // primary database + active schema, same as every table this tab
  // creates before this feature existed.
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const is_pg = conn?.kind === "postgres";
  const recent_params = useStudioStore((s) => s.recentParams[conn_id]);
  const openSql = useStudioStore((s) => s.openSql);
  const own_database = recent_params?.database ?? conn?.name ?? "";
  // Seeded with the connection's own database so the Database dropdown shows
  // it the moment the tab opens; the catalog fetch below (a remote round
  // trip) then fills in the sibling databases and the schema list.
  const [database, setDatabase] = useState(own_database);
  const [schema, setSchema] = useState("");
  const [databases, setDatabases] = useState<string[]>(
    own_database ? [own_database] : [],
  );
  const [schemas, setSchemas] = useState<string[]>([]);
  // True while the schema list for the CURRENTLY selected database is being
  // (re)fetched — the Schema dropdown disables itself for that stretch
  // rather than briefly offering the previous database's schemas.
  const [schemas_loading, setSchemasLoading] = useState(false);
  // `undefined` = targeting this connection's own database — every API
  // call here treats an explicit own-database the same as omitting it, but
  // passing `undefined` (rather than the resolved name) keeps `runSql`'s
  // activity-log entry and the connection's secondary-pool bookkeeping
  // identical to how every OTHER "app" query already targets its own db.
  const target_database =
    database && database !== own_database ? database : undefined;

  // Per-database schema list + default schema, cached by database name so
  // switching back and forth between databases (own included) instantly
  // restores the right list instead of leaving a previously-visited
  // database's schemas on screen — a plain "last database fetched" ref
  // can't tell "already have this one cached" apart from "just came from
  // this one," so a real per-key cache is needed, not a single slot.
  const schemas_cache = useRef<
    Record<string, { list: string[]; default_schema: string }>
  >({});

  useEffect(() => {
    if (!is_pg) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- claims the loading flag synchronously so the dropdown disables the instant the fetch starts; the real work is already async below
    setSchemasLoading(true);
    void (async () => {
      try {
        const overview = await catalogOverview(conn_id);
        if (cancelled) return;
        // Always the first schema in the list, not the connection's
        // current active schema — same rule the switch effect below uses,
        // so picking a database (own included) always behaves the same way.
        const default_schema = overview.schemas[0] ?? "public";
        schemas_cache.current[own_database] = {
          list: overview.schemas,
          default_schema,
        };
        setDatabases(overview.databases);
        setSchemas(overview.schemas);
        setDatabase(own_database);
        setSchema(default_schema);
      } catch {
        /* selectors stay empty — table still creates in the own db/schema */
      } finally {
        if (!cancelled) setSchemasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- own_database intentionally excluded: it's derived from the same conn_id and only needs the initial value on mount
  }, [conn_id, is_pg]);

  // Re-sync the schema list/selection whenever the target database changes
  // (own database included, e.g. switching back to it after visiting a
  // sibling) — instant from the cache above when already fetched, else a
  // fresh `listSchemasIn` call that populates the cache for next time.
  useEffect(() => {
    if (!is_pg || !database) return;
    const cached = schemas_cache.current[database];
    if (cached) {
      setSchemas(cached.list);
      setSchema(cached.default_schema);
      return;
    }
    // Own database not cached yet = the initial `catalogOverview` above is
    // still in flight and will fill it; don't fire a second round trip.
    if (database === own_database) return;
    let cancelled = false;
    setSchemasLoading(true);
    void (async () => {
      try {
        const list = await listSchemasIn(conn_id, database);
        if (cancelled) return;
        const default_schema = list[0] ?? "public";
        schemas_cache.current[database] = { list, default_schema };
        setSchemas(list);
        setSchema(default_schema);
      } catch {
        /* keep the previous schema list */
      } finally {
        if (!cancelled) setSchemasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, is_pg, database, own_database]);

  // Table list for the FK "references" picker — scoped to the currently
  // selected target database/schema, refetched whenever either changes so
  // switching schemas doesn't offer tables that don't live there. A
  // different target also invalidates any cached FK metadata (`ref_meta`) —
  // same table name in a different schema is a different table.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears stale cached metadata synchronously the instant the target changes; the real work is already async below
    setRefMeta({});
    void (async () => {
      try {
        const objects = is_pg
          ? await listSchemaObjects(
              conn_id,
              schema || "public",
              "table",
              target_database,
            )
          : await listSchemaObjects(conn_id, "", "table");
        if (!cancelled) setTableNames(objects.map((o) => o.name));
      } catch {
        if (!cancelled) setTableNames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, is_pg, schema, target_database]);

  /** Load a referenced table's metadata once: columns, PK, and which columns
   *  are legal FK targets. */
  const ensure_columns = async (ref_table: string): Promise<RefTableMeta> => {
    const cached = ref_meta[ref_table];
    if (cached) return cached;
    try {
      const schema_info = await tableSchema(
        conn_id,
        ref_table,
        target_database,
        is_pg ? schema : undefined,
      );
      const cols = schema_info.columns.map((c) => c.name);
      const pk_cols = schema_info.columns
        .filter((c) => c.primary_key)
        .map((c) => c.name);
      const valid_targets = new Set(pk_cols);
      for (const ix of schema_info.indexes) {
        // A single-column UNIQUE index makes that column referencable.
        if (ix.unique && ix.columns.length === 1)
          valid_targets.add(ix.columns[0]);
      }
      const meta: RefTableMeta = {
        cols,
        pk: pk_cols[0] ?? null,
        valid_targets: [...valid_targets],
      };
      setRefMeta((m) => ({ ...m, [ref_table]: meta }));
      return meta;
    } catch {
      const empty: RefTableMeta = { cols: [], pk: null, valid_targets: [] };
      setRefMeta((m) => ({ ...m, [ref_table]: empty }));
      return empty;
    }
  };

  const patch_fk = (idx: number, f: (k: FkDef) => void) => {
    let next_table: string | null = null;
    setFks((fks) =>
      fks.map((k, i) => {
        if (i !== idx) return k;
        const copy = { ...k };
        f(copy);
        if (copy.ref_table !== k.ref_table) {
          // Table switched — the previously chosen key no longer applies.
          copy.ref_column = "";
          next_table = copy.ref_table.trim();
        }
        return copy;
      }),
    );
    // Make sure the new table's column options are loaded (fetch + cache).
    if (next_table) void ensure_columns(next_table);
  };

  const do_create = async () => {
    if (creating) return;
    const target_schema = is_pg ? schema : undefined;
    const built = buildCreate({
      table: table_name,
      cols: columns,
      fks,
      indexes,
      constraints,
      schema: target_schema,
      is_pg,
    });
    if (!built.ok) {
      push_notification({
        kind: "error",
        title: "Cannot create table",
        detail: built.error,
      });
      return;
    }
    setCreating(true);
    // Only the first statement (the table) can leave nothing behind; each
    // index after it is its own statement.
    let created = false;
    try {
      for (const [i, stmt] of built.statements.entries()) {
        await runSql(conn_id, stmt, "app", target_database);
        if (i === 0) created = true;
      }
      push_notification({
        kind: "success",
        title: `Table ${table_name.trim()} created`,
        detail: built.sql,
      });
      on_modified();
      on_created(table_name.trim(), target_database, target_schema);
    } catch (e) {
      if (created) {
        // The table exists now, so the tab must not offer to create it again.
        on_modified();
        on_created(table_name.trim(), target_database, target_schema);
      }
      push_notification({
        kind: "error",
        title: created
          ? `Table ${table_name.trim()} created, but an index failed`
          : `Creating ${table_name.trim()} failed`,
        detail: String(e),
      });
    } finally {
      setCreating(false);
    }
  };

  const preview = useMemo(
    () =>
      buildCreate({
        table: table_name,
        cols: columns,
        fks,
        indexes,
        constraints,
        schema: is_pg ? schema : undefined,
        is_pg,
      }),
    [table_name, columns, fks, indexes, constraints, is_pg, schema],
  );

  // Publish the Create action to the action bar — but ONLY while this tab is
  // the active one, and flagged with whether the current draft is valid so
  // the button can disable itself. Refs keep the registered closure fresh.
  const create_ref = useRef(do_create);
  useEffect(() => {
    create_ref.current = do_create;
  });
  const creating_ref = useRef(creating);
  useEffect(() => {
    creating_ref.current = creating;
  }, [creating]);
  const valid = preview.ok;
  const has_draft =
    table_name.trim() !== "" ||
    columns.some((c, i) => {
      if (i === 0) {
        // The seeded first column counts as untouched only in its default form.
        return (
          c.name !== "id" ||
          c.data_type !== "INTEGER" ||
          !c.primary_key ||
          !c.auto_increment ||
          c.not_null ||
          c.unique ||
          c.default !== "" ||
          c.check !== "" ||
          c.length !== ""
        );
      }
      return true;
    }) ||
    fks.length > 0 ||
    indexes.length > 0 ||
    constraints.length > 0;
  const valid_ref = useRef(valid);
  useEffect(() => {
    valid_ref.current = valid;
  });
  const has_draft_ref = useRef(has_draft);
  useEffect(() => {
    has_draft_ref.current = has_draft;
  });
  useEffect(() => {
    if (!active) return;
    setNewTable(tab_key, {
      create: () => void create_ref.current(),
      creating: creating_ref.current,
      valid: valid_ref.current,
      has_draft: has_draft_ref.current,
    });
    // Re-runs whenever busy/validity/draft state flips, keeping the button
    // and close-guard in sync.
    return () => clearNewTable(tab_key);
  }, [active, tab_key, creating, valid, has_draft, setNewTable, clearNewTable]);

  const patch = (idx: number, f: (c: ColumnDef) => void) => {
    setColumns((cols) =>
      cols.map((c, i) => {
        if (i !== idx) return c;
        const copy = { ...c };
        f(copy);
        return copy;
      }),
    );
  };

  const restore_to_editor = () => {
    if (!preview.ok) return;
    openSql(conn_id, preview.sql);
  };

  const add = () => {
    if (tab === "columns") setColumns((cols) => [...cols, newColumn()]);
    else if (tab === "indexes") setIndexes((x) => [...x, newIndex()]);
    else if (tab === "foreign-keys") setFks((x) => [...x, newFk()]);
    else if (tab === "constraints")
      setConstraints((x) => [...x, newConstraint()]);
  };
  const add_label = {
    columns: "Add Column",
    indexes: "Add Index",
    "foreign-keys": "Add Foreign Key",
    constraints: "Add Constraint",
  }[tab];
  const column_names = columns.map((c) => c.name.trim()).filter(Boolean);
  const patch_list =
    <T,>(set: React.Dispatch<React.SetStateAction<T[]>>) =>
    (idx: number, p: Partial<T>) =>
      set((xs) => xs.map((x, i) => (i === idx ? { ...x, ...p } : x)));
  const remove_from =
    <T,>(set: React.Dispatch<React.SetStateAction<T[]>>) =>
    (idx: number) =>
      set((xs) => xs.filter((_, i) => i !== idx));

  return (
    // One scroll surface: vertical scrolling belongs to the whole tab;
    // horizontal overflow stays local to the grid.
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex gap-3">
        <div className="grid flex-1 gap-2">
          <label className="text-sm font-medium">Table name</label>
          <Input
            placeholder="users"
            value={table_name}
            onChange={(e) => setTableName(e.target.value)}
          />
        </div>
        {is_pg && (
          <>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Database</label>
              <Select
                value={database || null}
                onValueChange={(v) => v && setDatabase(v)}
              >
                <SelectTrigger className="w-44" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {databases.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Schema</label>
              <Select
                // `null`, not `undefined`: Base UI decides controlled vs
                // uncontrolled on the first render, and the schema is empty
                // until the catalog loads, so `undefined` would ignore it.
                value={schema || null}
                disabled={schemas_loading}
                onValueChange={(v) => v && setSchema(v)}
              >
                <SelectTrigger className="w-36" size="sm">
                  <SelectValue
                    placeholder={schemas_loading ? "Loading…" : undefined}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {schemas.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        <div className="flex items-end">
          <Button
            variant="outline"
            size="sm"
            disabled={!!conn?.read_only}
            title={
              conn?.read_only
                ? "Read only connection: import is refused"
                : "Create a table from a CSV, JSON or Excel file"
            }
            onClick={() =>
              openImport({
                connId: conn_id,
                database: target_database,
                schema: is_pg ? schema : undefined,
                onImported: on_modified,
              })
            }
          >
            <Upload className="size-3.5" />
            Import file
          </Button>
        </div>
      </div>

      {/* The tabs and their tools sit on top of the grid, in one box, so they
          read as part of the table. */}
      <div className="flex min-h-56 flex-1 flex-col overflow-hidden rounded-lg border">
        <div className="flex shrink-0 items-center gap-3 border-b p-2">
          <TabBar
            value={tab}
            onChange={setTab}
            counts={{
              indexes: indexes.length,
              "foreign-keys": fks.length,
              constraints: constraints.length,
            }}
          />
          {tab === "columns" && (
            <div className="relative w-44 shrink-0">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                className="h-7 rounded-full pl-8 text-sm"
                placeholder="Search column"
                aria-label="Search column"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}
          {add_label && (
            <Button
              size="sm"
              className="shrink-0"
              disabled={tab === "foreign-keys" && table_names.length === 0}
              title={
                tab === "foreign-keys" && table_names.length === 0
                  ? "No other tables to reference yet"
                  : undefined
              }
              onClick={add}
            >
              <Plus className="size-4" />
              {add_label}
            </Button>
          )}
          {tab === "columns" && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={table_names.length === 0}
              title={
                table_names.length === 0
                  ? "No other tables to copy from yet"
                  : undefined
              }
              onClick={() => setCopying(true)}
            >
              <Copy className="size-4" />
              Copy Fields from Another Table
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "columns" && (
            <ColumnsGrid
              columns={columns}
              query={query}
              onPatch={patch}
              onRemove={(idx) =>
                setColumns((cols) => cols.filter((_, i) => i !== idx))
              }
              onDuplicate={(idx) =>
                setColumns((cols) => [
                  ...cols.slice(0, idx + 1),
                  // A copy can't also be the primary key or the identity.
                  {
                    ...cols[idx],
                    primary_key: false,
                    auto_increment: false,
                  },
                  ...cols.slice(idx + 1),
                ])
              }
            />
          )}
          {tab === "indexes" && (
            <IndexesGrid
              indexes={indexes}
              columns={column_names}
              onPatch={patch_list(setIndexes)}
              onRemove={remove_from(setIndexes)}
            />
          )}
          {tab === "foreign-keys" && (
            <ForeignKeysGrid
              fks={fks}
              columns={columns}
              tableNames={table_names}
              refMeta={ref_meta}
              onPatch={patch_fk}
              onRemove={remove_from(setFks)}
            />
          )}
          {tab === "constraints" && (
            <ConstraintsGrid
              constraints={constraints}
              columns={column_names}
              onPatch={patch_list(setConstraints)}
              onRemove={remove_from(setConstraints)}
            />
          )}
        </div>
      </div>

      {copying && (
        <CopyFieldsDialog
          connId={conn_id}
          tables={table_names}
          database={target_database}
          schema={is_pg ? schema : undefined}
          onCopy={(cols) =>
            setColumns((cs) => {
              // The untouched seeded `id` column makes way for the copies.
              const seeded =
                cs.length === 1 &&
                cs[0].name === "id" &&
                cs[0].primary_key &&
                cs[0].auto_increment;
              return [...(seeded ? [] : cs), ...cols];
            })
          }
          onClose={() => setCopying(false)}
        />
      )}

      <div className="bg-background flex h-44 shrink-0 flex-col rounded-md border p-3">
        <div className="text-muted-foreground mb-1 flex justify-between text-xs font-medium">
          <span>Generated SQL</span>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Restore to editor"
            title="Open in a new, editable tab"
            onClick={restore_to_editor}
            className="ml-auto shrink-0"
            disabled={!preview.ok}
          >
            <SquareArrowOutUpRight />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {preview.ok ? (
            <QueryEditor
              value={preview.sql}
              onChange={() => {}}
              onRun={() => {}}
              onRunTarget={() => {}}
              lintEnabled={false}
              showLineNumber={false}
              className="rounded-md"
              frameLayer={false}
              autoCompletion={false}
              placeholder="e.g. age >= 18 AND name LIKE 'a%'"
              disableWrapping={false}
              disableEnter
              disableContextMenu
            />
          ) : (
            <code className="text-destructive">{preview.error}</code>
          )}
        </div>
      </div>
    </div>
  );
}
