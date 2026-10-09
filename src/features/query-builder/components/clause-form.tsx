import { useState } from "react";
import type { Clause } from "@/shared/store";
import {
  useCardColumns,
  useClauseActions,
  useOpenPicker,
  useTables,
} from "../lib/card-actions";
import { excludedKey, type Column } from "../lib/columns";
import { markersIn, maskMarkers, unmaskMarkers } from "../lib/markers";
import {
  parseConditions,
  printConditions,
  type Conditions,
} from "../lib/forms/conditions";
import {
  parseGroup,
  parseOrder,
  parseSelect,
  printGroup,
  printOrder,
  printSelect,
  type GroupForm,
  type Picked,
  type Sort,
} from "../lib/forms/lists";
import {
  parseFrom,
  parseJoinForm,
  printFrom,
  printJoin,
  type JoinForm,
} from "../lib/forms/tables";
import {
  parseConflict,
  parseInsert,
  parseReturning,
  parseSet,
  parseTarget,
  parseValues,
  printConflict,
  printInsert,
  printReturning,
  printSet,
  printTarget,
  printValues,
  type ConflictForm,
  type InsertForm,
  type ReturningForm,
  type SetRow,
  type ValuesForm,
} from "../lib/forms/writes";
import {
  parseLimit,
  parseTableRef,
  readCte,
  readSetOp,
  type Dialect,
  type TableRef,
} from "../lib/sql-text";
import { CompoundBody, CteBody } from "./forms/chain-forms";
import { ConditionsBody } from "./forms/conditions-form";
import { ConflictBody } from "./forms/conflict-form";
import { GroupBody } from "./forms/group-form";
import { InsertBody } from "./forms/insert-form";
import { TableRow } from "./forms/inputs";
import { JoinBody } from "./forms/join-form";
import { LimitBody } from "./forms/limit-form";
import { OrderBody } from "./forms/order-form";
import { ReturningBody } from "./forms/returning-form";
import { SelectBody } from "./forms/select-form";
import { SetRows } from "./forms/set-form";
import { ValuesBody } from "./forms/values-form";

/** A card's form model, by kind. */
type Model =
  | { kind: "from" | "update" | "delete" | "using"; table: TableRef | null }
  | { kind: "join"; join: JoinForm }
  | { kind: "where" | "having"; c: Conditions }
  | { kind: "group"; g: GroupForm }
  | { kind: "select"; items: Picked[] }
  | { kind: "order"; items: Sort[] }
  | { kind: "limit"; limit: string; offset: string }
  | { kind: "set"; rows: SetRow[] }
  | { kind: "insert"; f: InsertForm }
  | { kind: "values"; f: ValuesForm }
  | { kind: "conflict"; f: ConflictForm }
  | { kind: "returning"; f: ReturningForm }
  | { kind: "cte"; name: string; recursive: boolean; columns: string }
  | { kind: "compound"; op: string };

/** Kinds whose forms read a subquery's marker as `(SELECT __dh_sub_1)`, so
 *  it parses in any position. */
const MASKED: ReadonlySet<Clause["kind"]> = new Set([
  "where",
  "having",
  "select",
  "group",
  "order",
  "set",
  "conflict",
  "returning",
]);

/** The form for the card's text, or null when it can't show it. */
function read(c: Clause, dialect: Dialect): Model | null {
  return readText(
    MASKED.has(c.kind) ? { ...c, body: maskMarkers(c.body) } : c,
    dialect,
  );
}

function readText(c: Clause, dialect: Dialect): Model | null {
  const blank = !c.body.trim();
  switch (c.kind) {
    case "from": {
      if (blank) return { kind: "from", table: null };
      const table = parseFrom(c.body);
      return table && { kind: "from", table };
    }
    case "update":
    case "delete": {
      if (blank) return { kind: c.kind, table: null };
      const table = parseTarget(c.body);
      return table && { kind: c.kind, table };
    }
    case "using": {
      if (blank) return { kind: "using", table: null };
      const table = parseTableRef(c.body);
      return table && { kind: "using", table };
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
      if (blank) return { kind: "limit", limit: "", offset: "" };
      const l = parseLimit(c.body);
      return (
        l && {
          kind: "limit",
          limit: String(l.limit),
          offset: l.offset ? String(l.offset) : "",
        }
      );
    }
    case "set": {
      const rows = parseSet(c.body, dialect);
      return rows && { kind: "set", rows };
    }
    case "insert": {
      const f = parseInsert(c.body, dialect);
      return f && { kind: "insert", f };
    }
    case "values": {
      const f = parseValues(c.body, dialect);
      return f && { kind: "values", f };
    }
    case "conflict": {
      const f = parseConflict(c.body, dialect);
      return f && { kind: "conflict", f };
    }
    case "returning": {
      const f = parseReturning(c.body, dialect);
      return f && { kind: "returning", f };
    }
    case "cte": {
      if (blank)
        return { kind: "cte", name: "", recursive: false, columns: "" };
      const cte = readCte(c.body);
      return cte && { kind: "cte", ...cte };
    }
    case "compound": {
      const op = blank ? "UNION ALL" : readSetOp(c.body);
      return op && { kind: "compound", op };
    }
    case "statement":
      return null;
  }
}

function write(
  m: Model,
  columns: Column[],
): { body: string; aggregates?: string } {
  const typeOf = (name: string) =>
    columns.find((c) => c.name === name)?.type ?? null;
  switch (m.kind) {
    case "from":
    case "using":
      return { body: m.table ? printFrom(m.table) : "" };
    case "update":
    case "delete":
      return { body: m.table ? printTarget(m.table) : "" };
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
    case "set":
      return { body: printSet(m.rows, typeOf) };
    case "insert":
      return { body: printInsert(m.f) };
    case "values":
      return { body: printValues(m.f, (i) => columns[i]?.type ?? null) };
    case "conflict":
      return { body: printConflict(m.f, typeOf) };
    case "returning":
      return { body: printReturning(m.f) };
    case "cte": {
      const name = m.name.trim();
      if (!name) return { body: "" };
      const cols = m.columns.trim() ? ` ${m.columns.trim()}` : "";
      return { body: `${m.recursive ? "RECURSIVE " : ""}${name}${cols}` };
    }
    case "compound":
      return { body: m.op };
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
  const [seen, setSeen] = useState(text);
  const [wrote, setWrote] = useState(text);
  // Take the text in whenever it changed from outside the form (SQL view,
  // undo), never for the text the form itself just wrote. The card's text
  // arrives a render after a write, so that stale render is not a change.
  if (seen !== text) {
    setSeen(text);
    if (text !== wrote) {
      setWrote(text);
      setDraft(read(clause, dialect));
    }
  }
  if (!draft)
    return (
      <p className="text-muted-foreground text-small px-1">
        The form can't show this text, so it stays in SQL.
      </p>
    );

  // A run of edits in one form is one undo step, closed on blur. A marker
  // the form just wrote gets its new, empty subquery.
  const change = (m: Model) => {
    setDraft(m);
    const out = write(m, columns);
    out.body = unmaskMarkers(out.body);
    const had = new Set((clause.chains ?? []).map((ch) => ch.marker));
    const fresh = markersIn(out.body)
      .map((x) => x.n)
      .filter((n) => !had.has(n));
    setWrote(`${out.body}\n${out.aggregates ?? clause.aggregates ?? ""}`);
    actions.patch(clause.id, out, `form:${clause.id}`, fresh);
  };
  const newMarker = () => actions.newMarker(clause.id);

  return (
    <div className="flex flex-col gap-1.5" onBlur={actions.commitText}>
      <FormBody
        id={clause.id}
        model={draft}
        columns={columns}
        dialect={dialect}
        onChange={change}
        newMarker={newMarker}
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
  newMarker,
}: {
  id: string;
  model: Model;
  columns: Column[];
  dialect: Dialect;
  onChange: (m: Model) => void;
  /** A marker for a new subquery in this card. */
  newMarker: () => number;
}) {
  const picker = useOpenPicker();
  switch (m.kind) {
    case "from":
    case "using":
      return (
        <TableRow
          table={m.table}
          dialect={dialect}
          onTable={(table) => onChange({ ...m, table })}
          newMarker={newMarker}
          autoOpen={picker.id === id && !m.table}
          onOpened={picker.clear}
        />
      );
    case "update":
    case "delete":
      return (
        <TableRow
          table={m.table}
          dialect={dialect}
          onTable={(table) => onChange({ ...m, table })}
        />
      );
    case "cte":
      return (
        <CteBody
          name={m.name}
          recursive={m.recursive}
          columns={m.columns}
          onCte={(c) => onChange({ ...m, ...c })}
        />
      );
    case "compound":
      return <CompoundBody op={m.op} onOp={(op) => onChange({ ...m, op })} />;
    case "join":
      return (
        <JoinBody
          id={id}
          join={m.join}
          columns={columns}
          dialect={dialect}
          onJoin={(join) => onChange({ ...m, join })}
          newMarker={newMarker}
        />
      );
    case "where":
    case "having":
      return (
        <ConditionsBody
          c={m.c}
          columns={columns}
          onC={(c) => onChange({ ...m, c })}
          newMarker={newMarker}
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
        <SelectBody
          items={m.items}
          columns={columns}
          onItems={(items) => onChange({ ...m, items })}
          newMarker={newMarker}
        />
      );
    case "order":
      return (
        <OrderBody
          items={m.items}
          columns={columns}
          onItems={(items) => onChange({ ...m, items })}
        />
      );
    case "limit":
      return (
        <LimitBody
          limit={m.limit}
          offset={m.offset}
          onChange={(l) => onChange({ ...m, ...l })}
        />
      );
    case "set":
      return (
        <SetRows
          rows={m.rows}
          columns={columns}
          onRows={(rows) => onChange({ ...m, rows })}
          newMarker={newMarker}
        />
      );
    case "insert":
      return (
        <InsertBody
          f={m.f}
          columns={columns}
          dialect={dialect}
          onF={(f) => onChange({ ...m, f })}
        />
      );
    case "values":
      return (
        <ValuesBody
          f={m.f}
          columns={columns}
          onF={(f) => onChange({ ...m, f })}
          newMarker={newMarker}
        />
      );
    case "conflict":
      return (
        <Conflict
          id={id}
          f={m.f}
          columns={columns}
          dialect={dialect}
          onF={(f) => onChange({ ...m, f })}
          newMarker={newMarker}
        />
      );
    case "returning":
      return (
        <ReturningBody
          f={m.f}
          columns={columns}
          onF={(f) => onChange({ ...m, f })}
        />
      );
  }
}

/** The ON CONFLICT body with its key choices and `excluded.` columns. */
function Conflict({
  id,
  ...props
}: Omit<Parameters<typeof ConflictBody>[0], "keys" | "excluded"> & {
  id: string;
}) {
  const { keysOf } = useTables();
  const excluded = useCardColumns(excludedKey(id));
  return <ConflictBody {...props} keys={keysOf(id)} excluded={excluded} />;
}
