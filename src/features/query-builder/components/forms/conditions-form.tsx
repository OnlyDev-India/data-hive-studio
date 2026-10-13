import { Braces, Plus, X } from "lucide-react";
import { FormLabel, Pick, Text } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import type { Column } from "../../lib/columns";
import {
  emptyCond,
  NO_VALUE,
  OPS,
  SUB_OK,
  SUB_ONLY,
  type Cond,
  type Conditions,
  type Group,
  type Op,
} from "../../lib/forms/conditions";
import { SubqueryChip } from "./chain-forms";
import { ColumnInput } from "./inputs";

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
  EXISTS: "exists",
  "NOT EXISTS": "not exists",
};

/** `c` with its value back to a plain one. */
function plain(c: Cond): Cond {
  return {
    kind: "cond",
    column: c.column,
    op: c.op,
    values: [""],
    kinds: [null],
  };
}

function CondRow({
  c,
  columns,
  onC,
  onRemove,
  newMarker,
}: {
  c: Cond;
  columns: Column[];
  onC: (c: Cond) => void;
  onRemove: () => void;
  newMarker?: () => number;
}) {
  const setValues = (values: string[]) =>
    onC({ ...c, values, kinds: values.map(() => null) });
  const exists = SUB_ONLY.has(c.op);
  return (
    <div className="grid grid-cols-[1fr_6.5rem_1fr_1.5rem] items-center gap-1">
      {exists ? (
        <span className="text-muted-foreground text-small px-1">
          rows come back from
        </span>
      ) : (
        <ColumnInput
          columns={columns}
          value={c.column}
          onValue={(column) => onC({ ...c, column })}
        />
      )}
      <Pick
        label="Operator"
        value={c.op}
        options={OPS.filter(
          (o) => newMarker || !SUB_ONLY.has(o) || o === c.op,
        ).map((o) => [o, OP_LABEL[o] ?? o])}
        onValue={(op) => {
          const next = op as Op;
          if (SUB_ONLY.has(next)) {
            const sub = c.sub ?? newMarker?.();
            if (sub === undefined) return;
            onC({
              kind: "cond",
              column: "",
              op: next,
              values: [],
              kinds: [],
              sub,
            });
            return;
          }
          if (c.sub !== undefined && SUB_OK.has(next)) {
            onC({ ...c, op: next });
            return;
          }
          const base = c.sub !== undefined ? plain(c) : c;
          const n = NO_VALUE.has(next)
            ? 0
            : next === "BETWEEN"
              ? 2
              : Math.max(base.values.length, 1);
          onC({
            ...base,
            op: next,
            values: Array.from({ length: n }, (_, i) => base.values[i] ?? ""),
            kinds: Array.from({ length: n }, (_, i) => base.kinds[i] ?? null),
          });
        }}
      />
      {c.sub !== undefined ? (
        <SubqueryChip onRemove={exists ? undefined : () => onC(plain(c))} />
      ) : NO_VALUE.has(c.op) ? (
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
        <div className="flex min-w-0 items-center gap-0.5">
          <div className="min-w-0 flex-1">
            <Text
              label="Value"
              value={
                c.op === "IN" || c.op === "NOT IN"
                  ? c.values.join(", ")
                  : (c.values[0] ?? "")
              }
              placeholder={
                c.op === "IN" || c.op === "NOT IN" ? "a, b, c" : "value"
              }
              onValue={(v) =>
                setValues(
                  c.op === "IN" || c.op === "NOT IN"
                    ? v.split(",").map((x) => x.trim())
                    : [v],
                )
              }
              mono
            />
          </div>
          {newMarker && SUB_OK.has(c.op) && (
            <Button
              variant="ghost"
              size="iconXs"
              className="text-muted-foreground shrink-0"
              aria-label="Use a subquery"
              title="Use a subquery as the value"
              onClick={() =>
                onC({ ...c, values: [], kinds: [], sub: newMarker() })
              }
            >
              <Braces className="size-3" />
            </Button>
          )}
        </div>
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

export function ConditionsBody({
  c,
  columns,
  onC,
  newMarker,
}: {
  c: Conditions;
  columns: Column[];
  onC: (c: Conditions) => void;
  /** Offers subquery values, given where their markers come from. */
  newMarker?: () => number;
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
            newMarker={newMarker}
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
                newMarker={newMarker}
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
