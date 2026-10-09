import { memo, useMemo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Blocks, Info } from "lucide-react";
import { CardFrame, type CardFault } from "@/shared/components/builder-canvas";
import type { Clause } from "@/shared/store";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { useClauseActions } from "../lib/card-actions";
import { statementKeyword } from "../lib/model";
import { statementNote } from "../lib/parse-back";
import type { Dialect } from "../lib/sql-text";
import { SqlFragmentEditor } from "./sql-fragment-editor";

export interface StatementCardData extends Record<string, unknown> {
  query: string;
  clause: Clause;
  fault: CardFault | undefined;
  dialect: Dialect;
}

export type StatementCardNode = Node<StatementCardData, "statement">;

/** A statement the cards can't hold, kept as editable SQL. It never
 *  previews; Convert to cards turns it into cards once its text fits. */
export const StatementCard = memo(function StatementCard({
  data,
  selected,
}: NodeProps<StatementCardNode>) {
  const { query, clause, fault, dialect } = data;
  const actions = useClauseActions();
  const keyword = statementKeyword(clause.body);
  const { fits, note } = useMemo(
    () => statementNote(clause.body, dialect),
    [clause.body, dialect],
  );
  // Why Convert to cards could not, until the text changes.
  const [refused, setRefused] = useState<{ body: string; why: string } | null>(
    null,
  );
  const why = refused?.body === clause.body ? refused.why : null;

  return (
    <CardFrame
      label={`SQL statement, ${keyword}`}
      selected={!!selected}
      dragging={false}
      error={!!fault?.error}
    >
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-2">
        <span className="text-body px-1 font-mono font-semibold">SQL</span>
        <Badge variant="muted" className="font-mono">
          {keyword}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="nodrag text-muted-foreground ml-auto px-2"
          title={
            fits
              ? "Turn this statement into cards"
              : "Check whether this statement fits the cards"
          }
          onClick={() => {
            const no = actions.convert(query);
            setRefused(no ? { body: clause.body, why: no } : null);
          }}
        >
          <Blocks className="size-3.5" />
          Convert to cards
        </Button>
      </div>
      <div className="nodrag nowheel nopan flex cursor-text flex-col gap-1.5 p-2">
        <SqlFragmentEditor
          label="Statement text"
          value={clause.body}
          onChange={(v) =>
            actions.patch(clause.id, { body: v }, `body:${clause.id}`)
          }
          onBlur={actions.commitText}
          dialect={dialect}
          columns={[]}
          placeholder="CREATE INDEX orders_status ON orders (status)"
        />
        {(why || note) && (
          <p
            role={why ? "alert" : undefined}
            className="text-muted-foreground text-small flex items-start gap-1.5 px-1"
          >
            <Info className="mt-0.5 size-3 shrink-0" />
            {why ? `Can't convert: ${why}` : note}
          </p>
        )}
      </div>
      {fault?.error ? (
        <p
          role="alert"
          className="text-destructive text-small border-t px-3 py-1.5 font-mono"
        >
          {fault.error}
        </p>
      ) : (
        <p className="text-muted-foreground text-small border-t px-3 py-1.5">
          SQL statement, no preview
        </p>
      )}
    </CardFrame>
  );
});
