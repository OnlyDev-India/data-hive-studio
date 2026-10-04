import { useId, useRef, useState, type ReactNode } from "react";
import { Braces, Plus, X } from "lucide-react";
import { renderStage } from "@/shared/api";
import type { AggregationStage } from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";
import { useCardActions, useCardFields } from "../lib/card-actions";
import {
  ACCUMULATORS,
  MATCH_OPS,
  decodeForm,
  encodeForm,
  type FormModel,
  type GroupRow,
  type MatchRow,
  type ProjectRow,
  type SortRow,
} from "../lib/forms";
import { useStageValue } from "../lib/use-stage-value";

const MATCH_LABELS: Record<string, string> = {
  "=": "equals",
  $ne: "not equal",
  $gt: ">",
  $gte: "≥",
  $lt: "<",
  $lte: "≤",
  $in: "in",
  $nin: "not in",
  $exists: "exists",
  $regex: "matches",
};

/** A card's form. It reads the card's body as Rust parses it and writes each
 *  change back through Rust's renderer, so the JSON view always holds the
 *  same stage. A value the form cannot show keeps the card in JSON. */
export function StageForm({ stage }: { stage: AggregationStage }) {
  const actions = useCardActions();
  const parsed = useStageValue(stage.op, stage.body);
  const [draft, setDraft] = useState<FormModel | null>(null);
  const [synced, setSynced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // Take the body in whenever it changed from outside the form (JSON view,
  // undo), never for the text the form itself just wrote.
  if (parsed && parsed.body === stage.body && synced !== stage.body) {
    setSynced(stage.body);
    setDraft(parsed.ok ? decodeForm(stage.op, parsed.value) : null);
    setError(null);
  }

  const toJson = () => actions.setFlags(stage.id, { view: "json" });

  if (synced !== stage.body && !draft)
    return <p className="text-muted-foreground text-small px-1">Reading…</p>;
  if (parsed && !parsed.ok && synced === stage.body)
    return (
      <FormNotice onJson={toJson}>
        The JSON does not parse yet: {parsed.error}
      </FormNotice>
    );
  if (!draft)
    return (
      <FormNotice onJson={toJson}>
        This stage holds more than the form can show.
      </FormNotice>
    );

  const change = (m: FormModel) => {
    setDraft(m);
    const enc = encodeForm(m);
    if (!enc.ok) {
      setError(enc.error);
      return;
    }
    setError(null);
    const n = ++seq.current;
    renderStage(stage.op, enc.value)
      .then((body) => {
        if (n !== seq.current) return;
        setSynced(body);
        actions.setBody(stage.id, body);
      })
      .catch((e: unknown) => {
        if (n === seq.current)
          setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <div className="flex flex-col gap-1.5" onBlur={actions.commitText}>
      <FormBody id={stage.id} model={draft} onChange={change} />
      {error && (
        <p role="alert" className="text-destructive text-small px-1">
          {error}
        </p>
      )}
    </div>
  );
}

function FormNotice({
  children,
  onJson,
}: {
  children: ReactNode;
  onJson: () => void;
}) {
  return (
    <div className="text-muted-foreground text-small flex items-center gap-2 px-1">
      <span className="min-w-0 flex-1">{children}</span>
      <Button variant="outline" size="sm" onClick={onJson}>
        <Braces className="size-3" />
        Edit as JSON
      </Button>
    </div>
  );
}

function FormBody({
  id,
  model: m,
  onChange,
}: {
  id: string;
  model: FormModel;
  onChange: (m: FormModel) => void;
}) {
  switch (m.op) {
    case "$match":
      return (
        <Rows<MatchRow>
          rows={m.rows}
          add="Add condition"
          blank={{ field: "", op: "=", value: "" }}
          onRows={(rows) => onChange({ ...m, rows })}
          render={(r, set) => (
            <>
              <FieldInput
                id={id}
                value={r.field}
                onValue={(field) => set({ ...r, field })}
              />
              <Pick
                label="Condition"
                value={r.op}
                options={MATCH_OPS.map((o) => [o, MATCH_LABELS[o]])}
                onValue={(op) => set({ ...r, op: op as MatchRow["op"] })}
              />
              {r.op === "$exists" ? (
                <Pick
                  label="Exists"
                  value={r.value === "false" ? "false" : "true"}
                  options={[
                    ["true", "yes"],
                    ["false", "no"],
                  ]}
                  onValue={(value) => set({ ...r, value })}
                />
              ) : (
                <Text
                  label="Value"
                  value={r.value}
                  placeholder={
                    r.op === "$in" || r.op === "$nin"
                      ? "1, 2, 3"
                      : r.op === "$regex"
                        ? "^abc"
                        : "value"
                  }
                  onValue={(value) => set({ ...r, value })}
                  mono
                />
              )}
            </>
          )}
        />
      );
    case "$project":
      return (
        <Rows<ProjectRow>
          rows={m.rows}
          add="Add field"
          blank={{ field: "", mode: "include", value: "" }}
          onRows={(rows) => onChange({ ...m, rows })}
          render={(r, set) => (
            <>
              <FieldInput
                id={id}
                value={r.field}
                onValue={(field) => set({ ...r, field })}
              />
              <Pick
                label="Keep"
                value={r.mode}
                options={[
                  ["include", "include"],
                  ["exclude", "exclude"],
                  ["from", "from field"],
                ]}
                onValue={(mode) =>
                  set({ ...r, mode: mode as ProjectRow["mode"] })
                }
              />
              {r.mode === "from" ? (
                <FieldInput
                  id={id}
                  value={r.value}
                  onValue={(value) => set({ ...r, value })}
                  placeholder="source"
                />
              ) : (
                <span />
              )}
            </>
          )}
        />
      );
    case "$sort":
      return (
        <Rows<SortRow>
          rows={m.rows}
          add="Add sort field"
          blank={{ field: "", dir: 1 }}
          onRows={(rows) => onChange({ ...m, rows })}
          cols="grid-cols-[1fr_7rem_1.5rem]"
          render={(r, set) => (
            <>
              <FieldInput
                id={id}
                value={r.field}
                onValue={(field) => set({ ...r, field })}
              />
              <Pick
                label="Order"
                value={String(r.dir)}
                options={[
                  ["1", "ascending"],
                  ["-1", "descending"],
                ]}
                onValue={(d) => set({ ...r, dir: d === "-1" ? -1 : 1 })}
              />
            </>
          )}
        />
      );
    case "$limit":
    case "$skip":
      return (
        <Labeled
          label={m.op === "$limit" ? "Keep the first" : "Skip the first"}
        >
          <Text
            label="Documents"
            value={m.n}
            inputMode="numeric"
            onValue={(n) => onChange({ ...m, n })}
            mono
          />
        </Labeled>
      );
    case "$group":
      return (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground text-caption px-1">
            Group by {m.keys.length === 0 && "(everything in one group)"}
          </p>
          <Rows
            rows={m.keys}
            add="Add group key"
            blank={{ name: "", field: "" }}
            onRows={(keys) => onChange({ ...m, keys })}
            cols="grid-cols-[1fr_1fr_1.5rem]"
            render={(k, set) => (
              <>
                <FieldInput
                  id={id}
                  value={k.field}
                  onValue={(field) => set({ ...k, field })}
                />
                <Text
                  label="Key name"
                  value={k.name}
                  placeholder={m.keys.length > 1 ? "name" : "name (optional)"}
                  onValue={(name) => set({ ...k, name })}
                />
              </>
            )}
          />
          <p className="text-muted-foreground text-caption px-1">Outputs</p>
          <Rows<GroupRow>
            rows={m.rows}
            add="Add output"
            blank={{ name: "", acc: "$sum", arg: "1" }}
            onRows={(rows) => onChange({ ...m, rows })}
            render={(r, set) => (
              <>
                <Text
                  label="Output name"
                  value={r.name}
                  placeholder="name"
                  onValue={(name) => set({ ...r, name })}
                />
                <Pick
                  label="Accumulator"
                  value={r.acc}
                  options={ACCUMULATORS.map((a) => [a, a])}
                  onValue={(acc) => set({ ...r, acc: acc as GroupRow["acc"] })}
                  mono
                />
                {r.acc === "$count" ? (
                  <span />
                ) : (
                  <FieldInput
                    id={id}
                    value={r.arg}
                    refs
                    onValue={(arg) => set({ ...r, arg })}
                    placeholder="$field or 1"
                  />
                )}
              </>
            )}
          />
        </div>
      );
    case "$lookup":
      return (
        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-2 gap-y-1">
          <FormLabel>From collection</FormLabel>
          <Text
            label="From collection"
            value={m.from}
            onValue={(from) => onChange({ ...m, from })}
            mono
          />
          <FormLabel>Local field</FormLabel>
          <FieldInput
            id={id}
            value={m.localField}
            onValue={(localField) => onChange({ ...m, localField })}
          />
          <FormLabel>Foreign field</FormLabel>
          <Text
            label="Foreign field"
            value={m.foreignField}
            onValue={(foreignField) => onChange({ ...m, foreignField })}
            mono
          />
          <FormLabel>Save as</FormLabel>
          <Text
            label="Save as"
            value={m.as}
            onValue={(as) => onChange({ ...m, as })}
            mono
          />
        </div>
      );
    case "$unwind":
      return (
        <div className="grid grid-cols-[6.5rem_1fr] items-center gap-x-2 gap-y-1">
          <FormLabel>Array field</FormLabel>
          <FieldInput
            id={id}
            value={m.path}
            onValue={(path) => onChange({ ...m, path })}
          />
          <FormLabel>Index field</FormLabel>
          <Text
            label="Index field"
            value={m.includeArrayIndex}
            placeholder="optional"
            onValue={(includeArrayIndex) =>
              onChange({ ...m, includeArrayIndex })
            }
            mono
          />
          <FormLabel>Keep empty</FormLabel>
          <label className="text-small text-muted-foreground flex items-center gap-2">
            <Switch
              checked={m.preserve}
              onCheckedChange={(preserve) => onChange({ ...m, preserve })}
            />
            Keep documents where the array is missing or empty
          </label>
        </div>
      );
  }
}

function Rows<T>({
  rows,
  add,
  blank,
  onRows,
  render,
  cols = "grid-cols-[1fr_6.5rem_1fr_1.5rem]",
}: {
  rows: T[];
  add: string;
  blank: T;
  onRows: (rows: T[]) => void;
  render: (row: T, set: (row: T) => void) => ReactNode;
  cols?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <div key={i} className={cn("grid items-center gap-1", cols)}>
          {render(r, (row) => onRows(rows.map((x, j) => (j === i ? row : x))))}
          <Button
            variant="ghost"
            size="iconXs"
            className="text-muted-foreground"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => onRows(rows.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground self-start"
        onClick={() => onRows([...rows, blank])}
      >
        <Plus className="size-3" />
        {add}
      </Button>
    </div>
  );
}

function FormLabel({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-small">{children}</span>;
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <FormLabel>{label}</FormLabel>
      <div className="w-28">{children}</div>
      <FormLabel>documents</FormLabel>
    </div>
  );
}

const INPUT = "text-small h-6 px-2";

function Text({
  label,
  value,
  onValue,
  placeholder,
  mono,
  inputMode,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  inputMode?: "numeric";
}) {
  return (
    <Input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => onValue(e.target.value)}
      className={cn(INPUT, mono && "font-mono")}
    />
  );
}

/** A field name box offering the fields the card's input holds; with `refs`
 *  it offers them as `$field` references. */
function FieldInput({
  id,
  value,
  onValue,
  placeholder = "field",
  refs = false,
}: {
  id: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  refs?: boolean;
}) {
  const fields = useCardFields(id);
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
        {fields.map((f) => (
          <option key={f} value={refs ? `$${f}` : f} />
        ))}
      </datalist>
    </>
  );
}

function Pick({
  label,
  value,
  options,
  onValue,
  mono,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onValue: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onValue(String(v))}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("text-small h-6! w-full", mono && "font-mono")}
      >
        <SelectValue>
          {(v: string) => options.find(([k]) => k === v)?.[1] ?? v}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map(([k, text]) => (
          <SelectItem key={k} value={k} className={cn(mono && "font-mono")}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
