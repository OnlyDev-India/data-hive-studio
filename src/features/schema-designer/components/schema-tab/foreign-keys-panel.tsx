import { useEffect, useState } from "react";
import { Link, Plus, Trash2, Undo2 } from "lucide-react";
import {
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@/shared/components/ui/accordion";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { listTables, tableSchema } from "@/shared/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";
import { fk_is_dirty, next_id, type FkDraft } from "./drafts";

const REFERENTIAL_ACTIONS = [
  "",
  "CASCADE",
  "SET NULL",
  "SET DEFAULT",
  "RESTRICT",
  "NO ACTION",
];

/** "Foreign keys" accordion section: editable constraint rows (Postgres —
 *  SQLite FKs are unnamed/system-managed and render read-only), plus an
 *  inline add-row form that suggests the referenced table's real columns. */
export function ForeignKeysPanel({
  conn_id,
  fks,
  columns,
  disabled = false,
  on_update,
  on_replace,
}: {
  conn_id: string;
  fks: FkDraft[];
  /** Kept (non-dropped) local column names. */
  columns: string[];
  disabled?: boolean;
  on_update: (id: string, patch: Partial<FkDraft>) => void;
  on_replace: (updater: (fs: FkDraft[]) => FkDraft[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft_col, setDraftCol] = useState("");
  const [draft_ref_table, setDraftRefTable] = useState("");
  const [draft_ref_col, setDraftRefCol] = useState("");
  const [draft_action, setDraftAction] = useState("");
  const [draft_on_update, setDraftOnUpdate] = useState("");
  /** All tables/views on the connection — the referenced-table dropdown. */
  const [tables_list, setTablesList] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listTables(conn_id)
      .then((ts) => {
        if (!cancelled) setTablesList(ts.map((t) => t.name));
      })
      .catch(() => {
        if (!cancelled) setTablesList([]);
      });
    return () => {
      cancelled = true;
    };
  }, [conn_id]);
  /** Columns per referenced table — fetched once, cached in state. */
  const [ref_cols_by_table, setRefColsByTable] = useState<
    Record<string, string[]>
  >({});
  const [ref_fetching, setRefFetching] = useState(false);

  // Same suggestion flow as the new-table FK picker: committing the ref-table
  // name (Enter / blur) describes it once and caches its columns. The fetch
  // starts from the event handler — no effect, no cascading renders.
  const ref_name = draft_ref_table.trim();
  const ref_col_options = ref_name
    ? (ref_cols_by_table[ref_name] ?? null)
    : null;

  const commit_ref_table = (raw: string) => {
    const t = raw.trim();
    setDraftRefTable(t);
    if (!t || ref_cols_by_table[t]) return;
    setRefFetching(true);
    void tableSchema(conn_id, t)
      .then((s) => {
        const names = s.columns.map((c) => c.name);
        setRefColsByTable((p) => ({ ...p, [t]: names }));
      })
      .catch(() => {
        // Unknown table — the free-text fallback stays available.
        setRefColsByTable((p) => ({ ...p, [t]: [] }));
      })
      .finally(() => setRefFetching(false));
  };

  const dirty_count = fks.filter(fk_is_dirty).length;

  const add_fk = () => {
    if (!draft_col || !draft_ref_table.trim() || !draft_ref_col.trim()) return;
    on_replace((fs) => [
      ...fs,
      {
        id: next_id(),
        orig_name: null,
        columns: [draft_col],
        ref_table: draft_ref_table.trim(),
        ref_columns: draft_ref_col
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        on_delete: draft_action,
        on_update: draft_on_update,
        orig_on_delete: null,
        orig_on_update: null,
        dropped: false,
      },
    ]);
    setAdding(false);
    setDraftCol("");
    setDraftRefTable("");
    setDraftRefCol("");
    setDraftAction("");
    setDraftOnUpdate("");
  };

  return (
    <AccordionItem value="foreign-keys">
      <AccordionTrigger>
        <span className="flex items-center gap-2">
          <Link className="size-4" />
          Foreign keys
          <Badge variant="muted">{fks.filter((f) => !f.dropped).length}</Badge>
          {dirty_count > 0 && <Badge variant="warning">edited</Badge>}
        </span>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="overflow-hidden rounded-md border">
          {/* Header — mirrors the row layout: constraint · on update · on delete */}
          <div className="bg-muted/40 text-muted-foreground flex items-center gap-1.5 border-b px-3 py-1.5 text-[10px] font-medium tracking-wide uppercase">
            <span className="min-w-0 flex-1 truncate">Foreign key</span>
            <span className="w-[6rem] shrink-0">On update</span>
            <span className="w-[6rem] shrink-0">On delete</span>
            <span className="w-7 shrink-0" />
          </div>
          {fks.map((fk) => (
            <FkRow
              key={fk.id}
              fk={fk}
              disabled={disabled}
              on_update={on_update}
              on_replace={on_replace}
            />
          ))}
          {!adding ? (
            <button
              type="button"
              disabled={disabled}
              className="text-muted-foreground hover:bg-muted/50 flex w-full items-center gap-2 border-t px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-50"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-3.5" />
              Add foreign key
            </button>
          ) : (
            <div className="bg-muted/30 flex flex-col gap-2 border-t p-3">
              {/* One line, reads like the constraint itself:
                  column → table.referenced_column */}
              <div className="flex items-center gap-2">
                <Select
                  value={draft_col}
                  onValueChange={(v) => setDraftCol(v ?? "")}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 min-w-0 flex-1 text-xs"
                  >
                    <SelectValue placeholder="local column" />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground shrink-0">→</span>
                <Select
                  value={draft_ref_table}
                  onValueChange={(v) => commit_ref_table(v ?? "")}
                  disabled={disabled}
                >
                  <SelectTrigger
                    size="sm"
                    className={cn(
                      "h-7 min-w-0 text-xs",
                      draft_ref_table ? "w-[45%] flex-none" : "flex-1",
                    )}
                  >
                    <SelectValue
                      placeholder={
                        tables_list === null
                          ? "loading tables…"
                          : "referenced table"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {tables_list === null ? (
                      <div className="text-muted-foreground px-2 py-1.5 text-xs">
                        loading…
                      </div>
                    ) : tables_list.length === 0 ? (
                      <div className="text-muted-foreground px-2 py-1.5 text-xs">
                        no tables found
                      </div>
                    ) : (
                      tables_list.map((t) => (
                        <SelectItem key={t} value={t} className="text-xs">
                          {t}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {draft_ref_table && (
                  <>
                    <span className="text-muted-foreground shrink-0 font-mono text-xs">
                      .
                    </span>
                    {ref_col_options && ref_col_options.length > 0 ? (
                      <Select
                        value={draft_ref_col}
                        onValueChange={(v) => setDraftRefCol(v ?? "")}
                      >
                        <SelectTrigger
                          size="sm"
                          className="h-7 min-w-0 flex-1 text-xs"
                        >
                          <SelectValue
                            placeholder={
                              ref_fetching ? "loading…" : "referenced column"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {ref_col_options.map((c) => (
                            <SelectItem key={c} value={c} className="text-xs">
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={draft_ref_col}
                        onChange={(e) => setDraftRefCol(e.target.value)}
                        placeholder={
                          ref_fetching
                            ? "loading columns…"
                            : "ref col(s), comma separated"
                        }
                        className="h-7 min-w-0 flex-1 text-xs"
                      />
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={draft_action}
                  onValueChange={(v) => setDraftAction(v ?? "")}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 min-w-0 flex-1 text-xs"
                  >
                    <SelectValue placeholder="ON DELETE (none)" />
                  </SelectTrigger>
                  <SelectContent>
                    {REFERENTIAL_ACTIONS.map((a) => (
                      <SelectItem
                        key={`d-${a || "none"}`}
                        value={a}
                        className="text-xs"
                      >
                        {a || "ON DELETE (none)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={draft_on_update}
                  onValueChange={(v) => setDraftOnUpdate(v ?? "")}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 min-w-0 flex-1 text-xs"
                  >
                    <SelectValue placeholder="ON UPDATE (none)" />
                  </SelectTrigger>
                  <SelectContent>
                    {REFERENTIAL_ACTIONS.map((a) => (
                      <SelectItem
                        key={`u-${a || "none"}`}
                        value={a}
                        className="text-xs"
                      >
                        {a || "ON UPDATE (none)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="ml-auto h-7 shrink-0"
                  onClick={add_fk}
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </AccordionPanel>
    </AccordionItem>
  );
}

function FkRow({
  fk,
  disabled = false,
  on_update,
  on_replace,
}: {
  fk: FkDraft;
  disabled?: boolean;
  on_update: (id: string, patch: Partial<FkDraft>) => void;
  on_replace: (updater: (fs: FkDraft[]) => FkDraft[]) => void;
}) {
  // Newly added (not yet applied) drafts have no constraint name yet — they
  // still render, flagged "new", so the user sees exactly what Apply will do.
  const is_new = fk.orig_name === null;
  return (
    <div
      className={cn(
        "flex flex-nowrap items-center gap-1.5 border-b px-3 py-2 text-sm last:border-0",
        fk.dropped && "opacity-50",
        is_new && !fk.dropped && "bg-primary/5",
      )}
    >
      {/* First slot is ALWAYS flex-1 — keeps the selects aligned under the
          "On update" / "On delete" header columns regardless of badge. */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {is_new ? (
          <Badge variant="success" className="shrink-0">
            new
          </Badge>
        ) : null}
        {fk.dropped ? (
          <span className="truncate font-medium line-through">
            {fk.orig_name}
          </span>
        ) : (
          <code
            className="bg-muted min-w-0 truncate rounded px-1.5 py-0.5 text-xs"
            title={`${fk.columns.join(", ")} → ${fk.ref_table}.${fk.ref_columns.join(", ")}`}
          >
            {fk.columns.join(", ")}
            <span className="text-muted-foreground mx-0.5">→</span>
            {fk.ref_table}.{fk.ref_columns.join(", ")}
          </code>
        )}
      </span>
      {fk.dropped && (
        <Badge variant="warning" className="shrink-0">
          drops
        </Badge>
      )}

      {/* ON UPDATE / ON DELETE — fixed widths matching the header columns */}
      <Select
        value={fk.on_update}
        onValueChange={(v) => on_update(fk.id, { on_update: v ?? "" })}
        disabled={disabled || fk.dropped}
      >
        <SelectTrigger size="sm" className="h-7 w-[6rem] shrink-0 text-xs">
          <SelectValue placeholder="on update" />
        </SelectTrigger>
        <SelectContent>
          {REFERENTIAL_ACTIONS.map((a) => (
            <SelectItem key={`ru-${a || "none"}`} value={a} className="text-xs">
              {a || "(none)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={fk.on_delete}
        onValueChange={(v) => on_update(fk.id, { on_delete: v ?? "" })}
        disabled={disabled || fk.dropped}
      >
        <SelectTrigger size="sm" className="h-7 w-[6rem] shrink-0 text-xs">
          <SelectValue placeholder="on delete" />
        </SelectTrigger>
        <SelectContent>
          {REFERENTIAL_ACTIONS.map((a) => (
            <SelectItem key={`rd-${a || "none"}`} value={a} className="text-xs">
              {a || "(none)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="iconXs"
        aria-label={fk.dropped ? "Restore foreign key" : "Remove foreign key"}
        title={
          fk.dropped ? "Restore" : is_new ? "Remove" : `Drop ${fk.orig_name}`
        }
        disabled={disabled}
        className="shrink-0"
        onClick={() => {
          if (is_new) on_replace((fs) => fs.filter((f) => f.id !== fk.id));
          else on_update(fk.id, { dropped: !fk.dropped });
        }}
      >
        {fk.dropped || is_new ? (
          <Undo2 className="size-3.5" />
        ) : (
          <Trash2 className="size-3.5" />
        )}
      </Button>
    </div>
  );
}
