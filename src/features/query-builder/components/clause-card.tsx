import { memo } from "react";
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
import { CLAUSE_LABEL } from "../lib/model";
import type { Dialect } from "../lib/sql-text";
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
  cap: number;
  sampled: boolean;
  dialect: Dialect;
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
};

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
  const { clause, ordinal, preview, fault, skipped, cap, sampled, dialect } =
    data;
  const actions = useClauseActions();
  const columns = useCardColumns(clause.id);
  const names = columns.map((c) => c.name);
  const label = CLAUSE_LABEL[clause.kind];
  const join = clause.kind === "join";
  const fits = formFits(clause, dialect);
  const form = clause.view === "form" && fits;
  return (
    <CardFrame
      label={`Card ${ordinal}, ${label}`}
      selected={!!selected}
      dragging={!!dragging}
      error={!!fault?.error}
      dashed={skipped}
    >
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-1">
        <span
          className={cn(
            "text-muted-foreground flex items-center",
            join ? "clause-drag cursor-grab" : "opacity-30",
          )}
          title={join ? "Drag to reorder the joins" : "Cards keep SQL's order"}
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
          {skipped ? (
            <Badge
              variant="muted"
              title="Left out of the query until filled in"
            >
              Empty, skipped
            </Badge>
          ) : (
            <PreviewStatus
              preview={preview}
              fault={fault}
              cap={cap}
              sampled={sampled}
              noun="rows"
              source="rows of the table"
            />
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
          {clause.kind !== "from" && (
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
                  {clause.kind === "group" ? "Delete with HAVING" : "Delete"}
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
              value={clause.body}
              onChange={(v) =>
                actions.patch(clause.id, { body: v }, `body:${clause.id}`)
              }
              onBlur={actions.commitText}
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
      {!skipped && (
        <CardFooter
          preview={preview}
          fault={fault}
          firstRow={firstRow}
          empty="No rows come out of this card."
          earlier="Waiting on an earlier card"
          timeoutHint=". Raise the limit in the builder settings, or narrow an earlier card."
        />
      )}
    </CardFrame>
  );
});
