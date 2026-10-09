import type { Clause, ClauseKind } from "@/shared/store";
import { Builder, parseError } from "./built";
import {
  composeChains,
  expand,
  tableIn,
  type Env,
  type Mode,
  type Texts,
} from "./compose";
import {
  parseInsert,
  parseTarget,
  printInsert,
  printTarget,
} from "./forms/writes";
import { isMarker } from "./markers";
import { CLAUSE_LABEL, isEmpty, kindOf, orderErrors, SKIPPABLE } from "./model";
import {
  joinText,
  parseJoin,
  parseTableRef,
  tableText,
  type Dialect,
  type TableRef,
} from "./sql-text";

/** What an empty card that can't be left out says. */
const EMPTY: Partial<Record<ClauseKind, string>> = {
  update: "Pick a table to update",
  set: "Set at least one column",
  delete: "Pick a table to delete from",
  insert: "Pick a table to insert into",
  values: "Add a row of values",
  join: "Pick a table to join",
};

/** What a card's text must be, when it is not. */
const SHAPE: Partial<Record<ClauseKind, string>> = {
  update: "UPDATE takes one table, with an optional alias",
  delete: "DELETE takes one table, with an optional alias",
  insert: "INSERT takes one table and an optional column list",
  from: "FROM takes one table, with an optional alias",
  join: "JOIN takes the join type, one table with an optional alias, and ON or USING",
};

function fits(c: Clause, dialect: Dialect): boolean {
  switch (c.kind) {
    case "update":
    case "delete":
      return !!parseTarget(c.body);
    case "insert":
      return !!parseInsert(c.body, dialect);
    case "from":
      return !!parseTableRef(c.body);
    case "join":
      return !!parseJoin(c.body);
    default:
      return true;
  }
}

/** The words before a card's text. */
function lead(c: Clause): string {
  switch (c.kind) {
    case "update":
      return "UPDATE ";
    case "delete":
      return "DELETE FROM ";
    case "insert":
      return "INSERT INTO ";
    case "values":
      return /^\s*\(/.test(c.body) ? " VALUES " : " ";
    case "conflict":
      return " ON CONFLICT ";
    case "join":
      return " ";
    default:
      return ` ${CLAUSE_LABEL[c.kind]} `;
  }
}

/** A card's text in `mode`: its tables qualified for output, then its
 *  subqueries written out. */
function piece(
  c: Clause,
  env: Env,
  chains: Map<number, Texts>,
  mode: Mode,
): string {
  const body = c.body.trim();
  const q = (t: TableRef) => tableIn(env, t, mode);
  let text = body;
  switch (mode === "output" ? c.kind : null) {
    case "update":
    case "delete":
      text = printTarget(q(parseTarget(body)!));
      break;
    case "insert": {
      const f = parseInsert(body, env.dialect)!;
      text = printInsert({ ...f, table: f.table && q(f.table) });
      break;
    }
    case "from":
    case "using": {
      const t = parseTableRef(body);
      if (t) text = tableText(q(t));
      break;
    }
    case "join": {
      const j = parseJoin(body)!;
      text = joinText({ ...j, table: q(j.table) });
      break;
    }
  }
  return expand({ ...c, body: text }, chains, mode);
}

/** Compose an UPDATE, DELETE or INSERT query into `env.out`: no previews
 *  of its own (its subqueries still preview), only the text for Run (bare
 *  names) and for Copy and Open (schema qualified on Postgres), and each
 *  card's own errors. */
export function composeWrite(clauses: Clause[], env: Env) {
  const { out, dialect } = env;
  const { errors, skipped } = out;
  for (const [id, m] of orderErrors(clauses)) errors.set(id, m);
  if (errors.size > 0) return;
  const update = kindOf(clauses) === "update";

  const used: { c: Clause; chains: Map<number, Texts> }[] = [];
  for (const c of clauses) {
    if (isEmpty(c)) {
      // An UPDATE's FROM is optional, unless JOINs hang off it.
      const optional = SKIPPABLE.has(c.kind) || (update && c.kind === "from");
      if (!optional) errors.set(c.id, EMPTY[c.kind] ?? "Fill in this card");
      else if (c.kind === "from" && clauses.some((x) => x.kind === "join"))
        errors.set(c.id, "Pick a table, or delete the JOINs after it");
      else skipped.add(c.id);
      continue;
    }
    if (!fits(c, dialect)) {
      errors.set(c.id, SHAPE[c.kind]!);
      continue;
    }
    const t = SOURCES.has(c.kind) ? cardSource(c) : null;
    if (t && isMarker(t.name) && !t.alias) {
      errors.set(c.id, "A subquery here needs an alias");
      continue;
    }
    const chains = composeChains(c, env, [], true);
    if (chains) used.push({ c, chains });
  }
  if (errors.size > 0) return;

  const build = (mode: Mode) => {
    const b = new Builder();
    for (const { c, chains } of used) {
      b.add(lead(c));
      b.add(piece(c, env, chains, mode), c.id);
    }
    return b.done();
  };
  const plain = build("plain");
  const bad = parseError(plain, dialect, used.at(-1)?.c.id ?? clauses[0].id);
  if (bad) {
    errors.set(bad.id, bad.message);
    return;
  }
  out.sql = plain.text;
  out.output = build("output").text;
}

const SOURCES: ReadonlySet<ClauseKind> = new Set(["from", "join", "using"]);

/** The table or subquery a FROM, JOIN or USING card reads. */
const cardSource = (c: Clause) =>
  c.kind === "join"
    ? (parseJoin(c.body)?.table ?? null)
    : parseTableRef(c.body);
