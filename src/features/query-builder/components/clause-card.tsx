import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import {
  Code,
  GripVertical,
  ListChecks,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { SqlPreviewChunk } from "@/shared/api";
import {
  CardFooter,
  CardFrame,
  PreviewStatus,
  type CardFault,
} from "@/shared/components/builder-canvas";
import type { Clause } from "@/shared/store";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { useCardColumns, useClauseActions } from "../lib/card-actions";
import { OWN_CHAIN, viewText } from "../lib/chains";
import { CLAUSE_LABEL } from "../lib/model";
import { readSetOp, type Dialect } from "../lib/sql-text";
import type { ClausePreview } from "../lib/use-sql-previews";
import { ClauseForm, formFits } from "./clause-form";
import { SqlFragmentEditor } from "./sql-fragment-editor";

export interface ClauseCardData extends Record<string, unknown> {
  clause: Clause;
  /** 1 based place in the query. */
  ordinal: number;
  preview: ClausePreview | undefined;
  fault: CardFault | undefined;
  skipped: boolean;
  /** Holds a bind variable, so it waits for Run to ask for the value. */
  bind: boolean;
  /** Its query is not the current one, so its preview is from before. */
  stale: boolean;
  cap: number;
  sampled: boolean;
  dialect: Dialect;
  /** A write query's card: never previews. */
  noPreview: boolean;
  /** Not one of the query's fixed cards. */
  removable: boolean;
  /** In a subquery that reads the outer row, so it runs no preview. */
  outerRow: boolean;
  /** Can be dragged among the cards of its kind. */
  movable: boolean;
}

export type ClauseCardNode = Node<ClauseCardData, "clause">;

const PLACEHOLDER: Record<Clause["kind"], string> = {
  from: "orders o",
  join: "LEFT JOIN customers c ON c.id = o.customer_id",
  where: "o.total > 100 AND c.country = 'NL'",
  group: "c.country",
  having: "COUNT(*) > 10",
  select: "c.country, COUNT(*) AS orders",
  order: "orders DESC",
  limit: "100 OFFSET 0",
  update: "orders o",
  set: "status = 'paid', total = total * 1.1",
  delete: "orders o",
  using: "customers c",
  insert: "orders (id, total)",
  values: "(1, 10), (2, 20)",
  conflict: "(id) DO UPDATE SET total = excluded.total",
  returning: "id, total",
  statement: "CREATE INDEX orders_status ON orders (status)",
  cte: "recent AS (SELECT * FROM orders WHERE …)",
  compound: "UNION ALL SELECT id FROM archived_orders",
};

/** Text that holds a subquery, so the SQL view commits it on blur. */
const SUBQUERY = /\(\s*(select|with)\b/i;

/** A row as `column: value` pairs, for a card's collapsed first row. */
function firstRow(chunk: SqlPreviewChunk) {
  const row = chunk.rows[0];
  if (!row) return null;
  const pairs = chunk.columns.map((c, i) => `${c}: ${row[i] ?? "NULL"}`);
  return { line: pairs.join(", "), text: pairs.join("\n") };
}

export const ClauseCard = memo(function ClauseCard({
  data,
  selected,
  dragging,
}: NodeProps<ClauseCardNode>) {
  const {
    clause,
    ordinal,
    preview: last,
    fault,
    skipped,
    bind,
    stale,
    cap,
    sampled,
    dialect,
    noPreview,
    removable,
    outerRow,
    movable,
  } = data;
  // A stale card shows its last result, never a spinner it no longer has.
  const preview =
    stale && last ? { status: "ready" as const, chunk: last.chunk } : last;
  const actions = useClauseActions();
  const columns = useCardColumns(clause.id);
  const names = columns.map((c) => c.name);
  const label =
    clause.kind === "compound"
      ? (readSetOp(clause.body) ?? CLAUSE_LABEL.compound)
      : CLAUSE_LABEL[clause.kind];
  const join = movable;
  const fits = formFits(clause, dialect);
  const form = clause.view === "form" && fits;
  // Text with a subquery is kept here while typed and committed on blur,
  // when its subqueries become chains again.
  const [draft, setDraft] = useState<string | null>(null);
  const holds = OWN_CHAIN.has(clause.kind) || (clause.chains?.length ?? 0) > 0;
  const sql_text = draft ?? viewText(clause);
  const onSql = (v: string) => {
    if (draft === null && !holds && !SUBQUERY.test(v)) {
      actions.patch(clause.id, { body: v }, `body:${clause.id}`);
      return;
    }
    setDraft(v);
  };
  const commitSql = () => {
    if (draft !== null) actions.commitSql(clause.id, draft);
    setDraft(null);
    actions.commitText();
  };
  return (
    <CardFrame
      label={`Card ${ordinal}, ${label}`}
      selected={!!selected}
      dragging={!!dragging}
      error={!!fault?.error}
      dashed={skipped}
      sideHandle={(clause.chains?.length ?? 0) > 0}
    >
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-1">
        <span
          className={cn(
            "text-muted-foreground flex items-center",
            join ? "clause-drag cursor-grab" : "opacity-30",
          )}
          title={
            join
              ? `Drag to reorder the ${clause.kind === "join" ? "joins" : clause.kind === "cte" ? "CTEs" : "set operations"}`
              : "Cards keep SQL's written order"
          }
        >
          <GripVertical className="size-3.5" />
        </span>
        <span className="text-muted-foreground text-caption w-4 text-right tabular-nums">
          {ordinal}
        </span>
        <span className="text-body px-1.5 font-mono font-semibold">
          {label}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {outerRow && !noPreview ? (
            <Badge
              variant="muted"
              title="This subquery reads a column of the query around it, so it previews only inside it"
            >
              Outer row
            </Badge>
          ) : noPreview ? (
            skipped && (
              <Badge
                variant="muted"
                title="Left out of the query until filled in"
              >
                Empty, skipped
              </Badge>
            )
          ) : skipped ? (
            <Badge
              variant="muted"
              title="Left out of the query until filled in"
            >
              Empty, skipped
            </Badge>
          ) : bind && !fault?.error ? (
            <Badge
              variant="muted"
              title="Previews skip a card with a bind variable"
            >
              Needs a value
            </Badge>
          ) : (
            <>
              {stale && preview?.chunk && (
                <Badge
                  variant="muted"
                  title="From an earlier preview. Pick this query to refresh it."
                >
                  Stale
                </Badge>
              )}
              <span className={cn("min-w-0", stale && "opacity-50")}>
                <PreviewStatus
                  preview={preview}
                  fault={fault}
                  cap={cap}
                  sampled={sampled}
                  noun="rows"
                  source="rows of the table"
                />
              </span>
            </>
          )}
          <Button
            variant="ghost"
            size="iconXs"
            className="nodrag text-muted-foreground"
            aria-label={form ? "Edit as SQL" : "Edit as form"}
            title={
              form
                ? "Edit as SQL"
                : fits
                  ? "Edit as form"
                  : "The form can't show this text"
            }
            disabled={!form && !fits}
            onClick={() => actions.setView(clause.id, form ? "sql" : "form")}
          >
            {form ? (
              <Code className="size-3.5" />
            ) : (
              <ListChecks className="size-3.5" />
            )}
          </Button>
          {removable && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="iconXs"
                    className="nodrag text-muted-foreground"
                    aria-label={`Card ${ordinal} actions`}
                    title="More"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => actions.remove(clause.id)}
                >
                  <Trash2 />
                  {clause.kind === "group"
                    ? "Delete with HAVING"
                    : clause.kind === "from"
                      ? "Delete with its JOINs"
                      : "Delete"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <div
        className={cn(
          "nodrag nowheel nopan flex flex-col gap-1.5 p-2",
          !form && "cursor-text",
        )}
      >
        {clause.view === "form" && !fits && (
          <p className="text-muted-foreground text-small px-1">
            The form can't show this text, so it opens in SQL.
          </p>
        )}
        {form ? (
          <ClauseForm clause={clause} dialect={dialect} />
        ) : (
          <>
            <SqlFragmentEditor
              label={`${label} text`}
              value={sql_text}
              onChange={onSql}
              onBlur={commitSql}
              dialect={dialect}
              columns={names}
              placeholder={
                clause.kind === "group"
                  ? "Key columns, such as c.country"
                  : PLACEHOLDER[clause.kind]
              }
            />
            {clause.kind === "group" && (
              <SqlFragmentEditor
                label="Aggregates"
                value={clause.aggregates ?? ""}
                onChange={(v) =>
                  actions.patch(
                    clause.id,
                    { aggregates: v },
                    `aggregates:${clause.id}`,
                  )
                }
                onBlur={actions.commitText}
                dialect={dialect}
                columns={names}
                placeholder="Aggregates, such as COUNT(*) AS n, SUM(total) AS revenue"
              />
            )}
          </>
        )}
      </div>
      {noPreview ? (
        fault?.error ? (
          <p
            role="alert"
            className="text-destructive text-small border-t px-3 py-1.5 font-mono"
          >
            {fault.error}
          </p>
        ) : (
          <p className="text-muted-foreground text-small border-t px-3 py-1.5">
            Write query, no preview
          </p>
        )
      ) : outerRow && !fault?.error ? (
        <p className="text-muted-foreground text-small border-t px-3 py-1.5">
          Depends on the outer row, previewed inside its query
        </p>
      ) : bind && !fault?.error ? (
        <p className="text-muted-foreground text-small border-t px-3 py-1.5">
          Needs a value, asked on Run
        </p>
      ) : (
        !skipped && (
          <div className={cn(stale && "opacity-50")}>
            <CardFooter
              preview={preview}
              fault={fault}
              firstRow={firstRow}
              empty="No rows come out of this card."
              earlier="Waiting on an earlier card"
              timeoutHint=". Raise the limit in the builder settings, or narrow an earlier card."
            />
          </div>
        )
      )}
    </CardFrame>
  );
});
