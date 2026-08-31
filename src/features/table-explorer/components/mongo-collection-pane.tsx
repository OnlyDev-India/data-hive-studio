import { useEffect, useState, useCallback, useMemo } from "react";
import {
  listDocuments,
  saveDocument,
  tableSchema,
  type ColumnInfo,
  type QueryOp,
  type TableSchema,
} from "@/shared/api";
import { FilterBar, type FilterColumn } from "@/shared/components/data-grid/filter-bar";
import { Grid } from "@/shared/components/data-grid/grid";
import { ModeTabs } from "./mode-tabs";
import { useStudioStore, usePaneMode } from "@/shared/store";
import type { GridFilter } from "@/shared/components/data-grid/types";
import {
  AlertCircle,
  Loader2,
  Database,
  Braces,
  Save,
  Check,
  X,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";

const PAGE_SIZE = 50;

// Translate one filter-bar condition into a Mongo query fragment.
const mongoOp = (op: string): string => {
  switch (op) {
    case "eq":
      return "$eq";
    case "neq":
      return "$ne";
    case "contains":
    case "starts_with":
    case "ends_with":
      return "$regex";
    case "gt":
      return "$gt";
    case "gte":
      return "$gte";
    case "lt":
      return "$lt";
    case "lte":
      return "$lte";
    case "is_null":
      return "$eq";
    case "is_not_null":
      return "$ne";
    default:
      return "$eq";
  }
};

const buildFilterValue = (op: string, value: string): unknown => {
  if (value === "true") return true;
  if (value === "false") return false;
  const opLower = op.toLowerCase();
  if (opLower === "contains") return { $regex: value, $options: "i" };
  if (opLower === "starts_with") return { $regex: `^${value}`, $options: "i" };
  if (opLower === "ends_with") return { $regex: `${value}$`, $options: "i" };
  if (value === "") return "";
  const num = Number(value);
  if (!Number.isNaN(num) && value.trim() !== "") return num;
  return value;
};

/** Build a Mongo `$and`/`$or` filter object from the filter-bar conditions.
 *  `custom_where` (a raw Mongo query document) wins when present. */
function buildFilter(filters: GridFilter[], custom_where: string): Record<string, unknown> | null {
  const trimmed = custom_where.trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (filters.length === 0) return null;
  const conds = filters
    .map((f) => {
      const field = f.column;
      const value = buildFilterValue(f.op, f.value ?? "");
      if (f.op === "is_null") return { [field]: { $eq: null } };
      if (f.op === "is_not_null") return { [field]: { $ne: null } };
      if (f.op === "contains" || f.op === "starts_with" || f.op === "ends_with") {
        return { [field]: value };
      }
      const mop = mongoOp(f.op);
      return { [field]: { [mop]: value } };
    })
    .filter(Boolean) as Record<string, unknown>[];
  if (conds.length === 0) return null;
  if (conds.length === 1) return conds[0];
  const use_or = filters.every((f) => f.conjunction === "OR");
  return use_or ? { $or: conds } : { $and: conds };
}

export function MongoCollectionPane({
  conn_id,
  tab_key,
  collection,
  on_modified,
}: {
  conn_id: string;
  tab_key: string;
  database: string;
  collection: string;
  on_modified: () => void;
}) {
  const view = useStudioStore((s) => s.mongoViews[tab_key] ?? "grid");
  const grid_loading = useStudioStore((s) => !!s.gridBridges[tab_key]?.loading);
  const mode = usePaneMode(conn_id, tab_key);
  const setPaneMode = useStudioStore((s) => s.setPaneMode);
  const setMode = useCallback(
    (m: "data" | "schema") => setPaneMode(conn_id, tab_key, m),
    [setPaneMode, conn_id, tab_key],
  );
  // Actions from the store. In json mode the pane owns the bridge (the Grid is
  // unmounted), so it drives the same action-bar pagination/refresh controls.
  const setGridBridge = useStudioStore((s) => s.setGridBridge);
  const clearGridBridge = useStudioStore((s) => s.clearGridBridge);

  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [failed, setFailed] = useState(false);
  const [fail_error, setFailError] = useState<string | null>(null);
  const [filters, setFilters] = useState<GridFilter[]>([]);
  const [custom_where, setCustomWhere] = useState("");
  const [refresh_rev, setRefreshRev] = useState(0);

  const bump_refresh = useCallback(() => {
    setRefreshRev((r) => r + 1);
    on_modified();
  }, [on_modified]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await tableSchema(conn_id, collection);
        if (!cancelled) {
          setSchema(s);
          setFailed(false);
        }
      } catch (e) {
        if (!cancelled) {
          setFailed(true);
          setFailError(String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id, collection, refresh_rev]);

  const add_filter = (filter: Omit<GridFilter, "id">) => {
    setFilters((cur) => {
      const id = cur.reduce((m, f) => Math.max(m, f.id), 0) + 1;
      return [...cur, { ...filter, id, conjunction: filter.conjunction ?? "AND" }];
    });
  };
  const remove_filter = (id: number) => setFilters((cur) => cur.filter((f) => f.id !== id));
  const set_filter_conjunction = (id: number, conjunction: "AND" | "OR") =>
    setFilters((cur) => cur.map((f) => (f.id === id ? { ...f, conjunction } : f)));
  const clear_filters = () => {
    setFilters([]);
    setCustomWhere("");
  };

  // ---- JSON view: own data + a custom bridge so the action bar still drives
  // pagination/refresh without the Grid mounted.
  const [json_page, setJsonPage] = useState(0);
  const [json_page_size, setJsonPageSize] = useState(PAGE_SIZE);
  const [json_docs, setJsonDocs] = useState<unknown[]>([]);
  const [json_total, setJsonTotal] = useState(0);
  const [json_loading, setJsonLoading] = useState(false);
  const [json_error, setJsonError] = useState<string | null>(null);

  const json_filter = useMemo(
    () => buildFilter(filters, custom_where),
    [filters, custom_where],
  );

  useEffect(() => {
    if (view !== "json") return;
    let cancelled = false;
    void (async () => {
      setJsonLoading(true);
      setJsonError(null);
      try {
        const res = await listDocuments(conn_id, collection, {
          filter: json_filter ?? undefined,
          skip: json_page * json_page_size,
          limit: json_page_size,
        });
        if (!cancelled) {
          setJsonDocs(res.documents);
          setJsonTotal(res.total);
        }
      } catch (e) {
        if (!cancelled) setJsonError(String(e));
      } finally {
        if (!cancelled) setJsonLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, conn_id, collection, json_filter, json_page, json_page_size, refresh_rev]);

  // Register a bridge for the json view so the action-bar Limit/Pagination/
  // Refresh controls operate on the JSON document list.
  useEffect(() => {
    if (view !== "json") return;
    const total_pages = json_total === 0 ? 1 : Math.ceil(json_total / json_page_size);
    const bridge = {
      rows: json_docs.length,
      total: json_total,
      loading: json_loading,
      total_pages,
      page: json_page,
      set_page: setJsonPage,
      page_size: json_page_size,
      set_page_size: (n: number) => {
        setJsonPageSize(n);
        setJsonPage(0);
      },
      has_full_row: false,
      selected_count: 0,
      editable: false,
      elapsed_ms: null,
      delete_rows: () => { },
      pending_exists: false,
      pending_count: 0,
      start_pending: () => { },
      apply_pending: () => { },
      cancel_pending: () => { },
      get_pending_changes: () => [],
      get_pending_sql: () => null,
      refresh: () => {
        bump_refresh();
      },
      get_export: () => null,
      get_filtered_op: (): Extract<QueryOp, { kind: "select" }> => ({
        kind: "select",
        table: collection,
        filters: [],
        custom_where: undefined,
      }),
    };
    setGridBridge(tab_key, bridge);
    return () => {
      // Only clear the shared tab_key slot if we still own it — the grid also
      // stays mounted (hidden) now and may have re-registered its bridge.
      if (useStudioStore.getState().gridBridges[tab_key] === bridge) {
        clearGridBridge(tab_key);
      }
    };
  }, [
    view,
    tab_key,
    json_docs,
    json_total,
    json_loading,
    json_page,
    json_page_size,
    bump_refresh,
    collection,
    setGridBridge,
    clearGridBridge,
  ]);

  const columns: FilterColumn[] = (schema?.columns ?? []).map((c) => ({
    name: c.name,
    data_type: c.data_type,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="bg-background flex shrink-0 items-center gap-1 border-b px-3">
        <ModeTabs
          mode={mode}
          warn_no_pk={!!schema && schema.columns.every((c) => !c.primary_key)}
          on_change={setMode}
        />
        <div className="ml-auto flex items-center gap-1">
          {mode === "data" && view === "grid" && (
            <FilterBar
              columns={columns}
              distinct={{}}
              filters={filters}
              custom_where={custom_where}
              on_add={add_filter}
              on_remove={remove_filter}
              on_set_conjunction={set_filter_conjunction}
              on_clear={clear_filters}
              on_custom_where={setCustomWhere}
            />
          )}
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {failed ? (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
            <p className="text-destructive text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> Failed to load collection “{collection}”.
            </p>
            {fail_error && (
              <pre className="border-destructive/30 bg-destructive/5 text-destructive max-w-lg overflow-x-auto rounded-md border p-2 text-left font-mono text-xs whitespace-pre-wrap">
                {fail_error}
              </pre>
            )}
          </div>
        ) : mode === "schema" ? (
          schema && <MongoSchemaView columns={schema.columns} />
        ) : (
          <>
            {/* Both data views stay mounted and are hidden via CSS when
                inactive, so toggling grid/JSON never unmounts and refetches.
                The JSON document fetch is gated on `view === "json"`, so it
                only runs the first time JSON is shown. */}
            <div
              className={cn(
                view === "grid" ? "flex min-h-0 flex-1 flex-col" : "hidden",
              )}
            >
              {schema && (
                <Grid
                  conn_id={conn_id}
                  table={collection}
                  schema={schema}
                  revision={refresh_rev}
                  tab_key={tab_key}
                  filters={filters}
                  custom_where={custom_where}
                  distinct={{}}
                  on_refresh={bump_refresh}
                  active={view === "grid"}
                />
              )}
            </div>
            <div
              className={cn(
                view === "json" ? "flex min-h-0 flex-1 flex-col" : "hidden",
              )}
            >
              <JsonView
                docs={json_docs}
                loading={json_loading}
                error={json_error}
                on_retry={() => bump_refresh()}
                conn_id={conn_id}
                collection={collection}
                on_saved={bump_refresh}
              />
            </div>
          </>
        )}
        {mode === "data" && view === "grid" && !failed && (grid_loading || !schema) && (
          <div className="bg-background/60 absolute inset-0 z-80 flex items-center justify-center">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

function JsonView({
  docs,
  loading,
  error,
  on_retry,
  conn_id,
  collection,
  on_saved,
}: {
  docs: unknown[];
  loading: boolean;
  error: string | null;
  on_retry: () => void;
  conn_id: string;
  collection: string;
  on_saved: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [dirty, setDirty] = useState<Record<number, boolean>>({});
  const [parsed_error, setParsedError] = useState<Record<number, string | null>>({});

  const text_for = (i: number) => edits[i] ?? JSON.stringify(docs[i] ?? null, null, 2);

  const apply = async (i: number) => {
    const raw = text_for(i);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setParsedError((cur) => ({ ...cur, [i]: `Invalid JSON: ${String(e)}` }));
      return;
    }
    const id = (parsed as Record<string, unknown>)?.["_id"];
    if (typeof id !== "string") {
      setParsedError((cur) => ({
        ...cur,
        [i]: "Document is missing a string `_id` field — cannot save.",
      }));
      return;
    }
    setParsedError((cur) => ({ ...cur, [i]: null }));
    setSaving((cur) => ({ ...cur, [i]: true }));
    try {
      const ok = await saveDocument(conn_id, collection, id, parsed);
      if (ok) {
        pushNotification({
          kind: "success",
          title: "Document saved",
          description: `Updated document ${id}`,
        });
        setEdits((cur) => ({ ...cur, [i]: raw }));
        setDirty((cur) => ({ ...cur, [i]: false }));
        on_saved();
      } else {
        pushNotification({
          kind: "error",
          title: "Save failed",
          description: "No document was updated.",
        });
      }
    } catch (e) {
      setParsedError((cur) => ({ ...cur, [i]: String(e) }));
    } finally {
      setSaving((cur) => ({ ...cur, [i]: false }));
    }
  };

  return (
    <div className="min-h-0 flex-1 flex flex-col gap-3 p-3">
      {error && (
        <div className="bg-destructive/10 border-destructive/20 text-destructive flex items-center gap-2 border rounded-md p-3 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Error loading documents: {error}</span>
          <button onClick={on_retry} className="ml-auto text-xs underline hover:text-foreground">
            Retry
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {loading && docs.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center">No documents found.</div>
        ) : (
          <div className="flex flex-col gap-3">
            <span className="flex items-center gap-2 font-sans text-[11px] text-muted-foreground">
              <Braces className="h-3.5 w-3.5" /> {docs.length} document{docs.length === 1 ? "" : "s"} · edit the JSON then save
            </span>
            {docs.map((_, i) => (
              <div key={i} className="rounded-md border bg-background p-2">
                <div className="mb-1 flex items-center gap-2">
                  <Database className="text-muted-foreground h-3.5 w-3.5" />
                  <span className="font-sans text-[11px] text-muted-foreground">doc {i + 1}</span>
                  {edits[i] !== undefined && (
                    <span className="text-muted-foreground text-[11px]">
                      {dirty[i] ? "editing…" : "saved"}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => apply(i)}
                      disabled={saving[i] || !dirty[i]}
                      className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1 rounded px-2 py-1 text-xs disabled:opacity-40"
                    >
                      {saving[i] ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : dirty[i] ? (
                        <Save className="h-3 w-3" />
                      ) : (
                        <Check className="h-3 w-3" />
                      )}
                      Save
                    </button>
                    {edits[i] !== undefined && (
                      <button
                        onClick={() => {
                          setEdits((cur) => {
                            const n = { ...cur };
                            delete n[i];
                            return n;
                          });
                          setDirty((cur) => ({ ...cur, [i]: false }));
                          setParsedError((cur) => {
                            const n = { ...cur };
                            delete n[i];
                            return n;
                          });
                        }}
                        className="text-muted-foreground hover:text-foreground hover:bg-muted rounded p-1"
                        title="Revert"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </div>
                <textarea
                  spellCheck={false}
                  value={text_for(i)}
                  onChange={(e) => {
                    setEdits((cur) => ({ ...cur, [i]: e.target.value }));
                    setDirty((cur) => ({ ...cur, [i]: true }));
                    setParsedError((cur) => ({ ...cur, [i]: null }));
                  }}
                  className="font-mono bg-muted/30 focus:ring-ring min-h-30 w-full resize-y rounded border p-2 text-xs whitespace-pre focus:ring-1 focus:outline-none"
                />
                {parsed_error[i] && (
                  <div className="text-destructive mt-1 text-[11px]">{parsed_error[i]}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only inferred schema for a Mongo collection. Mongo is schemaless, so
 *  columns are sampled/inferred from the first 200 documents — shown here for
 *  reference (there is no DDL to edit). Styled to match the SQL schema tab's
 *  Columns panel. */
function MongoSchemaView({ columns }: { columns: ColumnInfo[] }) {
  const grid =
    "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2";
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <p className="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
        <Database className="h-3.5 w-3.5" />
        MongoDB is schemaless — fields below are inferred from a sample of up
        to 200 documents and are read-only.
      </p>
      <div className="overflow-hidden rounded-md border bg-background">
        <div
          className={cn(
            grid,
            "border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground",
          )}
        >
          <span>Field</span>
          <span>Type</span>
          <span>Flags</span>
        </div>
        {columns.length === 0 ? (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No fields inferred yet.
          </div>
        ) : (
          columns.map((c) => (
            <div
              key={c.name}
              className={cn(
                grid,
                "border-b px-3 py-1.5 text-sm last:border-0",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5 font-mono">
                {c.primary_key && (
                  <KeyRound className="text-primary size-3.5 shrink-0" />
                )}
                <span className="truncate">{c.name}</span>
              </span>
              <span className="min-w-0">
                <Badge variant="outline" className="font-mono">
                  {c.is_array ? `${c.data_type}[]` : c.data_type || "mixed"}
                </Badge>
              </span>
              <span className="text-muted-foreground truncate text-xs">
                {c.primary_key
                  ? "primary key"
                  : c.not_null
                    ? "required"
                    : "optional"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
