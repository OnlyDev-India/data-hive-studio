import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { listTables, quoteIdent, runSql, tableSchema } from "@/shared/api";
import { useStudioStore } from "@/shared/store";

const COLUMN_TYPES = [
  "INTEGER",
  "BIGINT",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
  "BOOLEAN",
  "UUID",
  "JSONB",
  "DATE",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "INET",
];

/** Referential actions SQLite accepts on a foreign key. */
const FK_ACTIONS = [
  "NO ACTION",
  "RESTRICT",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
] as const;
type FkAction = (typeof FK_ACTIONS)[number];

interface ColumnDef {
  name: string;
  data_type: string;
  primary_key: boolean;
  auto_increment: boolean;
  not_null: boolean;
  unique: boolean;
  default: string;
  /** Optional CHECK expression, e.g. `qty > 0` — emitted as CHECK (expr). */
  check: string;
}

interface FkDef {
  column: string;
  ref_table: string;
  ref_column: string;
  on_delete: FkAction;
  on_update: FkAction;
}

/** What we know about a table that can be referenced by a foreign key.
 *  SQLite only allows referencing columns that are a PRIMARY KEY or covered
 *  by a single-column UNIQUE index — everything else fails at insert time
 *  with `foreign key mismatch`. */
interface RefTableMeta {
  cols: string[];
  pk: string | null;
  valid_targets: string[];
}

function newColumn(): ColumnDef {
  return {
    name: "",
    data_type: "TEXT",
    primary_key: false,
    auto_increment: false,
    not_null: false,
    unique: false,
    default: "",
    check: "",
  };
}

function defaultColumn(): ColumnDef {
  return {
    ...newColumn(),
    name: "id",
    data_type: "INTEGER",
    primary_key: true,
    auto_increment: true,
  };
}

function newFk(): FkDef {
  return {
    column: "",
    ref_table: "",
    ref_column: "",
    on_delete: "NO ACTION",
    on_update: "NO ACTION",
  };
}

function buildCreateSql(
  table: string,
  cols: ColumnDef[],
  fks: FkDef[],
): { ok: true; sql: string } | { ok: false; error: string } {
  const table_name = table.trim();
  if (!table_name) return { ok: false, error: "Table name is required." };
  if (cols.length === 0)
    return { ok: false, error: "Add at least one column." };

  const pk_cols: string[] = [];
  for (const c of cols) {
    if (!c.name.trim())
      return { ok: false, error: "Every column needs a name." };
    if (c.primary_key) pk_cols.push(c.name.trim());
  }

  const auto_columns = cols.filter((c) => c.auto_increment).map((c) => c.name);
  if (auto_columns.length > 0) {
    const ok =
      pk_cols.length === 1 &&
      auto_columns.length === 1 &&
      pk_cols[0] === auto_columns[0].trim() &&
      cols.some(
        (c) =>
          c.name.trim() === auto_columns[0].trim() && c.data_type === "INTEGER",
      );
    if (!ok) {
      return {
        ok: false,
        error: "AUTOINCREMENT requires a single INTEGER PRIMARY KEY column.",
      };
    }
  }

  const parts: string[] = [];
  for (const c of cols) {
    const col_name = quoteIdent(c.name.trim());
    const ty = c.data_type.trim() || "TEXT";
    let def = `${col_name} ${ty}`;
    if (c.primary_key && pk_cols.length === 1) {
      def += " PRIMARY KEY";
      if (c.auto_increment) def += " AUTOINCREMENT";
    }
    if (c.not_null) def += " NOT NULL";
    if (c.unique) def += " UNIQUE";
    const d = c.default.trim();
    if (d) def += ` DEFAULT ${d}`;
    const chk = c.check.trim();
    if (chk) def += ` CHECK (${chk})`;
    parts.push(def);
  }
  if (pk_cols.length > 1) {
    const names = pk_cols.map((n) => quoteIdent(n)).join(", ");
    parts.push(`PRIMARY KEY (${names})`);
  }
  for (const [i, fk] of fks.entries()) {
    const label = fks.length > 1 ? `Foreign key #${i + 1}` : "Foreign key";
    if (!fk.column || !fk.ref_table.trim() || !fk.ref_column.trim()) {
      return {
        ok: false,
        error: `${label} is incomplete — pick the local column and fill in both referenced table and column.`,
      };
    }
    let def = `FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES ${quoteIdent(fk.ref_table.trim())} (${quoteIdent(fk.ref_column.trim())})`;
    if (fk.on_delete !== "NO ACTION") def += ` ON DELETE ${fk.on_delete}`;
    if (fk.on_update !== "NO ACTION") def += ` ON UPDATE ${fk.on_update}`;
    parts.push(def);
  }

  return {
    ok: true,
    sql: `CREATE TABLE ${quoteIdent(table_name)} (\n  ${parts.join(",\n  ")}\n);`,
  };
}

interface NewTableTabProps {
  conn_id: string;
  /** Store key this tab registers its Create action under. */
  tab_key: string;
  /** True when this tab is the visible one — the action-bar Create button
   *  is registered only for the active new-table tab. */
  active: boolean;
  on_modified: () => void;
  on_created: (name: string) => void;
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
  const [creating, setCreating] = useState(false);
  // Referencable tables + their columns (fetched lazily per selected table so
  // the FK rows can offer real pickers instead of free-text inputs).
  const [table_names, setTableNames] = useState<string[]>([]);
  const [ref_meta, setRefMeta] = useState<Record<string, RefTableMeta>>({});
  const push_notification = useStudioStore((s) => s.pushNotification);
  const setNewTable = useStudioStore((s) => s.setNewTable);
  const clearNewTable = useStudioStore((s) => s.clearNewTable);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tables = await listTables(conn_id);
        if (!cancelled) setTableNames(tables.map((t) => t.name));
      } catch {
        if (!cancelled) setTableNames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id]);

  /** Load a referenced table's metadata once: columns, PK, and which columns
   *  are legal FK targets. */
  const ensure_columns = async (ref_table: string): Promise<RefTableMeta> => {
    const cached = ref_meta[ref_table];
    if (cached) return cached;
    try {
      const schema = await tableSchema(conn_id, ref_table);
      const cols = schema.columns.map((c) => c.name);
      const pk_cols = schema.columns
        .filter((c) => c.primary_key)
        .map((c) => c.name);
      const valid_targets = new Set(pk_cols);
      for (const ix of schema.indexes) {
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
    const built = buildCreateSql(table_name, columns, fks);
    if (!built.ok) {
      push_notification({
        kind: "error",
        title: "Cannot create table",
        detail: built.error,
      });
      return;
    }
    setCreating(true);
    try {
      await runSql(conn_id, built.sql);
      push_notification({
        kind: "success",
        title: `Table ${table_name.trim()} created`,
        detail: built.sql,
      });
      on_modified();
      on_created(table_name.trim());
    } catch (e) {
      push_notification({
        kind: "error",
        title: `Creating ${table_name.trim()} failed`,
        detail: String(e),
      });
    } finally {
      setCreating(false);
    }
  };

  const preview = useMemo(
    () => buildCreateSql(table_name, columns, fks),
    [table_name, columns, fks],
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
          c.check !== ""
        );
      }
      return true;
    }) ||
    fks.length > 0;
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

  return (
    // One scroll surface: vertical scrolling belongs to the whole tab;
    // horizontal overflow stays local to the wide columns grid.
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Table name</label>
        <Input
          placeholder="users"
          value={table_name}
          onChange={(e) => setTableName(e.target.value)}
        />
      </div>

      {/* shrink-0 matters: a flex item with non-visible overflow loses
              its automatic min-height and would otherwise be squashed by
              the flex parent, clipping rows — now it keeps natural height
              and the tab root scrolls. */}
      <div className="shrink-0 overflow-x-auto rounded-md border">
        <div className="bg-muted text-muted-foreground flex min-w-max items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <span className="w-10 shrink-0 text-center">#</span>
          <span className="w-40 shrink-0">Column</span>
          <span className="w-28 shrink-0">Type</span>
          <span className="w-20 shrink-0 text-center">PK</span>
          <span className="w-24 shrink-0 text-center">Auto</span>
          <span className="w-20 shrink-0 text-center">Not null</span>
          <span className="w-20 shrink-0 text-center">Unique</span>
          <span className="w-28 shrink-0">Default</span>
          <span className="w-36 shrink-0">Check</span>
          <span className="w-8 shrink-0" />
        </div>
        {columns.map((col, idx) => (
          <div
            key={idx}
            className="flex min-w-max items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0"
          >
            <span className="text-muted-foreground w-10 shrink-0 text-center text-xs">
              {idx + 1}
            </span>
            <div className="w-40 shrink-0">
              <Input
                className="h-7"
                placeholder="column_name"
                value={col.name}
                onChange={(e) => patch(idx, (c) => (c.name = e.target.value))}
              />
            </div>
            <div className="w-28 shrink-0">
              <Select
                value={col.data_type}
                onValueChange={(v) =>
                  patch(idx, (c) => (c.data_type = v ?? ""))
                }
              >
                <SelectTrigger className="w-28" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {COLUMN_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-20 shrink-0 justify-center">
              <Checkbox
                checked={col.primary_key}
                onCheckedChange={(v) =>
                  patch(idx, (c) => (c.primary_key = v === true))
                }
              />
            </div>
            <div className="flex w-24 shrink-0 justify-center">
              <Checkbox
                checked={col.auto_increment}
                onCheckedChange={(v) =>
                  patch(idx, (c) => (c.auto_increment = v === true))
                }
              />
            </div>
            <div className="flex w-20 shrink-0 justify-center">
              <Checkbox
                checked={col.not_null}
                onCheckedChange={(v) =>
                  patch(idx, (c) => (c.not_null = v === true))
                }
              />
            </div>
            <div className="flex w-20 shrink-0 justify-center">
              <Checkbox
                checked={col.unique}
                onCheckedChange={(v) =>
                  patch(idx, (c) => (c.unique = v === true))
                }
              />
            </div>
            <div className="w-28 shrink-0">
              <Input
                className="h-7 font-mono"
                placeholder="0"
                value={col.default}
                onChange={(e) =>
                  patch(idx, (c) => (c.default = e.target.value))
                }
              />
            </div>
            <div className="w-36 shrink-0">
              <Input
                className="h-7 font-mono"
                placeholder="qty > 0"
                value={col.check}
                onChange={(e) => patch(idx, (c) => (c.check = e.target.value))}
              />
            </div>
            <div className="flex w-8 shrink-0 justify-center">
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Remove column"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() =>
                  setColumns((cols) => cols.filter((_, i) => i !== idx))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setColumns((cols) => [...cols, newColumn()])}
          >
            <Plus className="size-4" />
            Add column
          </Button>
        </div>
      </div>

      {/* Foreign keys — reference real tables/columns via dropdowns.
              Same flex treatment as the columns grid: shrink-0 keeps the
              natural height, x-overflow scrolls locally. */}
      <div className="shrink-0 overflow-x-auto rounded-md border">
        <div className="bg-muted/50 sticky left-0 flex items-center justify-between border-b px-3 py-2">
          <span className="text-muted-foreground text-xs font-medium">
            Foreign keys
            {fks.length > 0 && (
              <span className="bg-muted ml-2 rounded px-1.5 py-0.5">
                {fks.length}
              </span>
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={table_names.length === 0}
            title={
              table_names.length === 0
                ? "No other tables to reference yet"
                : undefined
            }
            onClick={() => setFks((fks) => [...fks, newFk()])}
          >
            <Plus className="size-3.5" />
            Add foreign key
          </Button>
        </div>
        {fks.length === 0 ? (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            None — add one to reference another table. The target column must be
            that table's primary key (
            <KeyRound className="inline size-3 text-amber-500" />) or UNIQUE
            (·U);.
          </p>
        ) : (
          fks.map((fk, idx) => (
            <div
              key={idx}
              className="flex min-w-max items-center gap-2 border-b px-3 py-2 text-sm last:border-0"
            >
              <Select
                value={fk.column || undefined}
                onValueChange={(v) =>
                  patch_fk(idx, (k) => (k.column = v ?? ""))
                }
              >
                <SelectTrigger className="w-40" size="sm">
                  <SelectValue placeholder="local column" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {columns
                      .filter((c) => c.name.trim())
                      .map((c) => (
                        <SelectItem key={c.name} value={c.name.trim()}>
                          {c.name.trim()}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">→</span>
              <Select
                value={fk.ref_table || undefined}
                onValueChange={(v) =>
                  patch_fk(idx, (k) => (k.ref_table = v ?? ""))
                }
              >
                <SelectTrigger className="w-44" size="sm">
                  <SelectValue placeholder="table" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {table_names.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">.</span>
              {/* key remounts on table switch: Base UI's Select goes
                  uncontrolled when value is undefined, so without this it
                  keeps displaying the previous table's selection. */}
              <Select
                key={fk.ref_table}
                value={fk.ref_column || undefined}
                disabled={!fk.ref_table}
                onValueChange={(v) =>
                  patch_fk(idx, (k) => (k.ref_column = v ?? ""))
                }
              >
                <SelectTrigger className="w-44" size="sm">
                  <SelectValue
                    placeholder={
                      (ref_meta[fk.ref_table]?.cols ?? []).filter((c) =>
                        ref_meta[fk.ref_table]?.valid_targets.includes(c),
                      ).length <= 0
                        ? "No Primary or unique key"
                        : fk.ref_table
                          ? "column"
                          : "pick a table"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(ref_meta[fk.ref_table]?.cols ?? []).filter((c) =>
                      ref_meta[fk.ref_table]?.valid_targets.includes(c),
                    ).length <= 0 && (
                      <SelectItem key={"empty"} value={"empty"} disabled>
                        No Primary or unique key
                      </SelectItem>
                    )}
                    {(ref_meta[fk.ref_table]?.cols ?? [])
                      .filter((c) =>
                        ref_meta[fk.ref_table]?.valid_targets.includes(c),
                      )
                      .map((c) => {
                        const meta = ref_meta[fk.ref_table];
                        return (
                          <SelectItem key={c} value={c}>
                            {c}
                            {meta?.pk === c ? (
                              <KeyRound className="size-4 text-amber-500!" />
                            ) : (
                              " ·U"
                            )}
                          </SelectItem>
                        );
                      })}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                ON DELETE
                <Select
                  value={fk.on_delete}
                  onValueChange={(v) =>
                    patch_fk(
                      idx,
                      (k) => (k.on_delete = (v ?? "NO ACTION") as FkAction),
                    )
                  }
                >
                  <SelectTrigger className="w-32" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {FK_ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
                ON UPDATE
                <Select
                  value={fk.on_update}
                  onValueChange={(v) =>
                    patch_fk(
                      idx,
                      (k) => (k.on_update = (v ?? "NO ACTION") as FkAction),
                    )
                  }
                >
                  <SelectTrigger className="w-32" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {FK_ACTIONS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Remove foreign key"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setFks((fks) => fks.filter((_, i) => i !== idx))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="bg-background rounded-md border p-3">
        <div className="text-muted-foreground mb-1 text-xs font-medium">
          Generated SQL
        </div>
        <pre className="bg-muted/50 max-h-40 overflow-auto rounded p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {preview.ok ? (
            <code>{preview.sql}</code>
          ) : (
            <code className="text-destructive">{preview.error}</code>
          )}
        </pre>
      </div>
    </div>
  );
}
