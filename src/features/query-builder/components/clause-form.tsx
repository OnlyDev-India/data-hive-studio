import { useId, useState, type ComponentProps } from "react";
import { ChevronDown, Code, Plus, X } from "lucide-react";
import {
  FormLabel,
  INPUT,
  Pick,
  Rows,
  Text,
} from "@/shared/components/builder-canvas";
import type { Clause } from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import {
  useCardColumns,
  useClauseActions,
  useTables,
} from "../lib/card-actions";
import type { Column } from "../lib/columns";
import {
  emptyCond,
  NO_VALUE,
  OPS,
  parseConditions,
  printConditions,
  type Cond,
  type Conditions,
  type Group,
  type Op,
} from "../lib/forms/conditions";
import {
  AGGREGATES,
  parseGroup,
  parseOrder,
  parseSelect,
  printGroup,
  printOrder,
  printSelect,
  type Aggregate,
  type GroupForm,
  type Picked,
  type Sort,
} from "../lib/forms/lists";
import {
  JOIN_TYPES,
  parseFrom,
  parseJoinForm,
  printFrom,
  printJoin,
  type JoinForm,
  type OnPair,
} from "../lib/forms/tables";
import { tableIdent } from "../lib/joins";
import { parseLimit, type Dialect, type TableRef } from "../lib/sql-text";
import { TablePicker } from "./table-picker";

/** A card's form model, by kind. */
type Model =
  | { kind: "from"; table: TableRef | null }
  | { kind: "join"; join: JoinForm }
  | { kind: "where" | "having"; c: Conditions }
  | { kind: "group"; g: GroupForm }
  | { kind: "select"; items: Picked[] }
  | { kind: "order"; items: Sort[] }
  | { kind: "limit"; limit: string; offset: string };

/** The form for the card's text, or null when it can't show it. */
function read(c: Clause, dialect: Dialect): Model | null {
  switch (c.kind) {
    case "from": {
      if (!c.body.trim()) return { kind: "from", table: null };
      const table = parseFrom(c.body);
      return table && { kind: "from", table };
    }
    case "join": {
      const join = parseJoinForm(c.body, dialect);
      return join && { kind: "join", join };
    }
    case "where":
    case "having": {
      const parsed = parseConditions(c.body, dialect);
      return parsed && { kind: c.kind, c: parsed };
    }
    case "group": {
      const g = parseGroup(c.body, c.aggregates ?? "", dialect);
      return g && { kind: "group", g };
    }
    case "select": {
      const items = parseSelect(c.body, dialect);
      return items && { kind: "select", items };
    }
    case "order": {
      const items = parseOrder(c.body, dialect);
      return items && { kind: "order", items };
    }
    case "limit": {
      if (!c.body.trim()) return { kind: "limit", limit: "", offset: "" };
      const l = parseLimit(c.body);
      return (
        l && {
          kind: "limit",
          limit: String(l.limit),
          offset: l.offset ? String(l.offset) : "",
        }
      );
    }
  }
}

function write(
  m: Model,
  typeOf: (column: string) => string | null,
): { body: string; aggregates?: string } {
  switch (m.kind) {
    case "from":
      return { body: m.table ? printFrom(m.table) : "" };
    case "join":
      return { body: printJoin(m.join) };
    case "where":
    case "having":
      return { body: printConditions(m.c, typeOf) };
    case "group": {
      const g = printGroup(m.g);
      return { body: g.keys, aggregates: g.aggregates };
    }
    case "select":
      return { body: printSelect(m.items) };
    case "order":
      return { body: printOrder(m.items) };
    case "limit": {
      const limit = m.limit.trim();
      if (!limit) return { body: "" };
      return {
        body: m.offset.trim() ? `${limit} OFFSET ${m.offset.trim()}` : limit,
      };
    }
  }
}

/** Whether the card's form can show its text. */
export function formFits(c: Clause, dialect: Dialect): boolean {
  return read(c, dialect) !== null;
}

/** A card's form. It reads the card's text and writes each change back as
 *  text, so the SQL view always holds the same clause. */
export function ClauseForm({
  clause,
  dialect,
}: {
  clause: Clause;
  dialect: Dialect;
}) {
  const actions = useClauseActions();
  const columns = useCardColumns(clause.id);
  const text = `${clause.body}\n${clause.aggregates ?? ""}`;
  const [draft, setDraft] = useState<Model | null>(() => read(clause, dialect));
  const [synced, setSynced] = useState(text);
  // Take the text in whenever it changed from outside the form (SQL view,
  // undo), never for the text the form itself just wrote.
  if (synced !== text) {
    setSynced(text);
    setDraft(read(clause, dialect));
  }
  if (!draft)
    return (
      <p className="text-muted-foreground text-small px-1">
        The form can't show this text, so it stays in SQL.
      </p>
    );

  const typeOf = (name: string) =>
    columns.find((c) => c.name === name)?.type ?? null;
  // A run of edits in one form is one undo step, closed on blur.
  const change = (m: Model) => {
    setDraft(m);
    const out = write(m, typeOf);
    setSynced(`${out.body}\n${out.aggregates ?? clause.aggregates ?? ""}`);
    actions.patch(clause.id, out, `form:${clause.id}`);
  };

  return (
    <div className="flex flex-col gap-1.5" onBlur={actions.commitText}>
      <FormBody
        id={clause.id}
        model={draft}
        columns={columns}
        dialect={dialect}
        onChange={change}
      />
    </div>
  );
}

function FormBody({
  id,
  model: m,
  columns,
  dialect,
  onChange,
}: {
  id: string;
  model: Model;
  columns: Column[];
  dialect: Dialect;
  onChange: (m: Model) => void;
}) {
  switch (m.kind) {
    case "from":
      return (
        <TableRow
          table={m.table}
          dialect={dialect}
          onTable={(table) => onChange({ ...m, table })}
        />
      );
    case "join":
      return (
        <JoinBody
          id={id}
          join={m.join}
          columns={columns}
          dialect={dialect}
          onJoin={(join) => onChange({ ...m, join })}
        />
      );
    case "where":
    case "having":
      return (
        <ConditionsBody
          c={m.c}
          columns={columns}
          onC={(c) => onChange({ ...m, c })}
        />
      );
    case "group":
      return (
        <GroupBody
          g={m.g}
          columns={columns}
          onG={(g) => onChange({ ...m, g })}
        />
      );
    case "select":
      return (
        <Rows<Picked>
          rows={m.items}
          add="Add column"
          blank={{ expr: "", alias: "" }}
          onRows={(items) => onChange({ ...m, items })}
          cols="grid-cols-[1fr_1fr_1.5rem]"
          render={(r, set) => (
            <>
              <ColumnInput
                columns={columns}
                value={r.expr}
                onValue={(expr) => set({ ...r, expr })}
              />
              <Text
                label="Alias"
                value={r.alias}
                placeholder="as (optional)"
                onValue={(alias) => set({ ...r, alias })}
                mono
              />
            </>
          )}
        />
      );
    case "order":
      return (
        <Rows<Sort>
          rows={m.items}
          add="Add sort column"
          blank={{ expr: "", dir: "ASC" }}
          onRows={(items) => onChange({ ...m, items })}
          cols="grid-cols-[1fr_7rem_1.5rem]"
          render={(r, set) => (
            <>
              <ColumnInput
                columns={columns}
                value={r.expr}
                onValue={(expr) => set({ ...r, expr })}
              />
              <Pick
                label="Direction"
                value={r.dir}
                options={[
                  ["ASC", "ascending"],
                  ["DESC", "descending"],
                ]}
                onValue={(dir) => set({ ...r, dir: dir as Sort["dir"] })}
              />
            </>
          )}
        />
      );
    case "limit":
      return (
        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-1.5">
          <FormLabel>Rows</FormLabel>
          <Text
            label="Row count"
            value={m.limit}
            placeholder="100"
            inputMode="numeric"
            onValue={(limit) => onChange({ ...m, limit })}
          />
          <FormLabel>skip</FormLabel>
          <Text
            label="Offset"
            value={m.offset}
            placeholder="0"
            inputMode="numeric"
            onValue={(offset) => onChange({ ...m, offset })}
          />
        </div>
      );
  }
}

/** A column box offering the card's columns. */
function ColumnInput({
  columns,
  value,
  onValue,
  placeholder = "column",
}: {
  columns: Column[];
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
}) {
  const list = useId();
  return (
    <>
      <Input
        aria-label={placeholder}
        value={value}
        placeholder={placeholder}
        list={list}
        onChange={(e) => onValue(e.target.value)}
        className={cn(INPUT, "font-mono")}
      />
      <datalist id={list}>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.type ?? ""}
          </option>
        ))}
      </datalist>
    </>
  );
}

function TableButton({ children, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      variant="outline"
      size="sm"
      className="nodrag h-6 min-w-0 flex-1 justify-between px-2 font-mono"
    >
      <span className="truncate">{children}</span>
      <ChevronDown className="text-muted-foreground size-3 shrink-0" />
    </Button>
  );
}

const tableName = (t: TableRef) =>
  t.schema ? `${t.schema}.${t.name}` : t.name;

function TableRow({
  table,
  dialect,
  onTable,
}: {
  table: TableRef | null;
  dialect: Dialect;
  onTable: (t: TableRef) => void;
}) {
  const { home } = useTables();
  return (
    <div className="flex items-center gap-1.5">
      <TablePicker
        trigger={
          <TableButton>{table ? tableName(table) : "Pick a table"}</TableButton>
        }
        onPick={(t) =>
          onTable({
            schema: null,
            name: tableIdent(t, home, dialect),
            alias: table?.alias ?? null,
          })
        }
      />
      <div className="w-28">
        <Text
          label="Alias"
          value={table?.alias ?? ""}
          placeholder="alias"
          onValue={(alias) =>
            table && onTable({ ...table, alias: alias.trim() || null })
          }
          mono
        />
      </div>
    </div>
  );
}

function JoinBody({
  id,
  join,
  columns,
  dialect,
  onJoin,
}: {
  id: string;
  join: JoinForm;
  columns: Column[];
  dialect: Dialect;
  onJoin: (j: JoinForm) => void;
}) {
  const { home, suggestions, aliasFor } = useTables();
  const on = join.on;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="w-28 shrink-0">
          <Pick
            label="Join type"
            value={join.type}
            options={JOIN_TYPES.map((t) => [t, t.replace(" JOIN", "")])}
            onValue={(type) =>
              onJoin({ ...join, type: type as JoinForm["type"] })
            }
          />
        </div>
        <TablePicker
          suggestions={suggestions(id)}
          trigger={
            <TableButton>
              {join.table ? tableName(join.table) : "Pick a table"}
            </TableButton>
          }
          onPick={(t, s) => {
            const alias = aliasFor(id, t.name);
            onJoin({
              ...join,
              table: {
                schema: null,
                name: tableIdent(t, home, dialect),
                alias,
              },
              on: s ? { mode: "pairs", pairs: s.on } : join.on,
            });
          }}
        />
        <div className="w-24 shrink-0">
          <Text
            label="Alias"
            value={join.table?.alias ?? ""}
            placeholder="alias"
            onValue={(alias) =>
              join.table &&
              onJoin({
                ...join,
                table: { ...join.table, alias: alias.trim() || null },
              })
            }
            mono
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <FormLabel>ON</FormLabel>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground ml-auto h-6 px-2"
          onClick={() =>
            onJoin({
              ...join,
              on:
                on.mode === "pairs"
                  ? {
                      mode: "text",
                      text: on.pairs
                        .filter((p) => p.left && p.right)
                        .map((p) => `${p.left} = ${p.right}`)
                        .join(" AND "),
                    }
                  : { mode: "pairs", pairs: [] },
            })
          }
        >
          <Code className="size-3" />
          {on.mode === "pairs" ? "Write it as text" : "Use column pairs"}
        </Button>
      </div>
      {on.mode === "pairs" ? (
        <Rows<OnPair>
          rows={on.pairs}
          add="Add column pair"
          blank={{ left: "", right: "" }}
          onRows={(pairs) => onJoin({ ...join, on: { mode: "pairs", pairs } })}
          cols="grid-cols-[1fr_auto_1fr_1.5rem]"
          render={(r, set) => (
            <>
              <ColumnInput
                columns={columns}
                value={r.left}
                onValue={(left) => set({ ...r, left })}
              />
              <span className="text-muted-foreground text-small">=</span>
              <ColumnInput
                columns={columns}
                value={r.right}
                onValue={(right) => set({ ...r, right })}
              />
            </>
          )}
        />
      ) : (
        <Text
          label="ON condition"
          value={on.text}
          placeholder="a.x = b.y AND b.active"
          onValue={(text) => onJoin({ ...join, on: { mode: "text", text } })}
          mono
        />
      )}
    </div>
  );
}

const OP_LABEL: Partial<Record<Op, string>> = {
  "=": "=",
  "<>": "≠",
  "<=": "≤",
  ">=": "≥",
  IN: "in",
  "NOT IN": "not in",
  LIKE: "like",
  "NOT LIKE": "not like",
  ILIKE: "ilike",
  BETWEEN: "between",
  "IS NULL": "is null",
  "IS NOT NULL": "is not null",
};

function CondRow({
  c,
  columns,
  onC,
  onRemove,
}: {
  c: Cond;
  columns: Column[];
  onC: (c: Cond) => void;
  onRemove: () => void;
}) {
  const setValues = (values: string[]) =>
    onC({ ...c, values, kinds: values.map(() => null) });
  return (
    <div className="grid grid-cols-[1fr_6.5rem_1fr_1.5rem] items-center gap-1">
      <ColumnInput
        columns={columns}
        value={c.column}
        onValue={(column) => onC({ ...c, column })}
      />
      <Pick
        label="Operator"
        value={c.op}
        options={OPS.map((o) => [o, OP_LABEL[o] ?? o])}
        onValue={(op) => {
          const next = op as Op;
          const n = NO_VALUE.has(next)
            ? 0
            : next === "BETWEEN"
              ? 2
              : Math.max(c.values.length, 1);
          onC({
            ...c,
            op: next,
            values: Array.from({ length: n }, (_, i) => c.values[i] ?? ""),
            kinds: Array.from({ length: n }, (_, i) => c.kinds[i] ?? null),
          });
        }}
      />
      {NO_VALUE.has(c.op) ? (
        <span />
      ) : c.op === "BETWEEN" ? (
        <div className="grid grid-cols-2 gap-1">
          {[0, 1].map((i) => (
            <Text
              key={i}
              label={i === 0 ? "From" : "To"}
              value={c.values[i] ?? ""}
              onValue={(v) =>
                setValues(c.values.map((x, j) => (j === i ? v : x)))
              }
              mono
            />
          ))}
        </div>
      ) : (
        <Text
          label="Value"
          value={
            c.op === "IN" || c.op === "NOT IN"
              ? c.values.join(", ")
              : (c.values[0] ?? "")
          }
          placeholder={c.op === "IN" || c.op === "NOT IN" ? "a, b, c" : "value"}
          onValue={(v) =>
            setValues(
              c.op === "IN" || c.op === "NOT IN"
                ? v.split(",").map((x) => x.trim())
                : [v],
            )
          }
          mono
        />
      )}
      <Button
        variant="ghost"
        size="iconXs"
        className="text-muted-foreground"
        aria-label="Remove condition"
        onClick={onRemove}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

function JoinWord({
  value,
  onValue,
}: {
  value: "AND" | "OR";
  onValue: (v: "AND" | "OR") => void;
}) {
  return (
    <div className="w-20">
      <Pick
        label="Join conditions with"
        value={value}
        options={[
          ["AND", "all of"],
          ["OR", "any of"],
        ]}
        onValue={(v) => onValue(v as "AND" | "OR")}
      />
    </div>
  );
}

function ConditionsBody({
  c,
  columns,
  onC,
}: {
  c: Conditions;
  columns: Column[];
  onC: (c: Conditions) => void;
}) {
  const set = (i: number, item: Cond | Group) =>
    onC({ ...c, items: c.items.map((x, j) => (j === i ? item : x)) });
  const remove = (i: number) =>
    onC({ ...c, items: c.items.filter((_, j) => j !== i) });
  return (
    <div className="flex flex-col gap-1">
      {c.items.length > 1 && (
        <div className="flex items-center gap-1.5">
          <FormLabel>Match</FormLabel>
          <JoinWord value={c.join} onValue={(join) => onC({ ...c, join })} />
        </div>
      )}
      {c.items.map((item, i) =>
        item.kind === "cond" ? (
          <CondRow
            key={i}
            c={item}
            columns={columns}
            onC={(x) => set(i, x)}
            onRemove={() => remove(i)}
          />
        ) : (
          <div
            key={i}
            className="rounded-control flex flex-col gap-1 border border-dashed p-1"
          >
            <div className="flex items-center gap-1.5">
              <FormLabel>Group, match</FormLabel>
              <JoinWord
                value={item.join}
                onValue={(join) => set(i, { ...item, join })}
              />
              <Button
                variant="ghost"
                size="iconXs"
                className="text-muted-foreground ml-auto"
                aria-label="Remove group"
                onClick={() => remove(i)}
              >
                <X className="size-3" />
              </Button>
            </div>
            {item.items.map((x, k) => (
              <CondRow
                key={k}
                c={x}
                columns={columns}
                onC={(y) =>
                  set(i, {
                    ...item,
                    items: item.items.map((z, j) => (j === k ? y : z)),
                  })
                }
                onRemove={() =>
                  set(i, {
                    ...item,
                    items: item.items.filter((_, j) => j !== k),
                  })
                }
              />
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground self-start"
              onClick={() =>
                set(i, { ...item, items: [...item.items, emptyCond()] })
              }
            >
              <Plus className="size-3" />
              Add condition
            </Button>
          </div>
        ),
      )}
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onC({ ...c, items: [...c.items, emptyCond()] })}
        >
          <Plus className="size-3" />
          Add condition
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            onC({
              ...c,
              items: [
                ...c.items,
                {
                  kind: "group",
                  join: c.join === "AND" ? "OR" : "AND",
                  items: [emptyCond(), emptyCond()],
                },
              ],
            })
          }
        >
          <Plus className="size-3" />
          Add group
        </Button>
      </div>
    </div>
  );
}

function GroupBody({
  g,
  columns,
  onG,
}: {
  g: GroupForm;
  columns: Column[];
  onG: (g: GroupForm) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FormLabel>Group by</FormLabel>
      <Rows<string>
        rows={g.keys}
        add="Add key column"
        blank=""
        onRows={(keys) => onG({ ...g, keys })}
        cols="grid-cols-[1fr_1.5rem]"
        render={(k, set) => (
          <ColumnInput columns={columns} value={k} onValue={set} />
        )}
      />
      <FormLabel>Aggregates</FormLabel>
      <Rows<Aggregate>
        rows={g.aggregates}
        add="Add aggregate"
        blank={{ fn: "COUNT", arg: "*", alias: "" }}
        onRows={(aggregates) => onG({ ...g, aggregates })}
        cols="grid-cols-[7rem_1fr_1fr_1.5rem]"
        render={(a, set) => (
          <>
            <Pick
              label="Aggregate"
              value={a.fn}
              options={AGGREGATES.map((f) => [f, f])}
              mono
              onValue={(fn) =>
                set({
                  ...a,
                  fn: fn as Aggregate["fn"],
                  arg: fn === "COUNT" ? a.arg : a.arg === "*" ? "" : a.arg,
                })
              }
            />
            <ColumnInput
              columns={
                a.fn === "COUNT"
                  ? [{ name: "*", type: null }, ...columns]
                  : columns
              }
              value={a.arg}
              onValue={(arg) => set({ ...a, arg })}
            />
            <Text
              label="Alias"
              value={a.alias}
              placeholder="as"
              onValue={(alias) => set({ ...a, alias })}
              mono
            />
          </>
        )}
      />
    </div>
  );
}
