import type { ReactElement } from "react";
import type { ClauseKind } from "@/shared/store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { CLAUSE_LABEL } from "../lib/model";

const HINT: Record<ClauseKind, string> = {
  from: "the table to start from",
  join: "rows from another table",
  where: "keep the rows that match",
  group: "one row per key, with aggregates",
  having: "keep the groups that match",
  select: "pick and name the columns",
  order: "sort the rows",
  limit: "keep the first rows",
  update: "the table to change",
  set: "the columns to change",
  delete: "the table to delete from",
  using: "other tables the WHERE reads",
  insert: "the table to add rows to",
  values: "the rows to add",
  conflict: "what to do when a key exists",
  returning: "the columns to hand back",
  statement: "any statement, kept as written",
  cte: "a named query the others can read",
  compound: "rows of another query, or INTERSECT, EXCEPT",
};

/** The clauses that fit one slot, opened from `trigger`. */
export function AddClauseMenu({
  kinds,
  trigger,
  onPick,
}: {
  kinds: ClauseKind[];
  trigger: ReactElement;
  onPick: (kind: ClauseKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="w-80">
        {kinds.map((k) => (
          <DropdownMenuItem key={k} onClick={() => onPick(k)}>
            <span className="w-28 shrink-0 font-mono font-semibold">
              {CLAUSE_LABEL[k]}
            </span>
            <span className="text-muted-foreground text-small truncate">
              {HINT[k]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
