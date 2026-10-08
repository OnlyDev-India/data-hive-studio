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
      <DropdownMenuContent align="start" className="w-64">
        {kinds.map((k) => (
          <DropdownMenuItem key={k} onClick={() => onPick(k)}>
            <span className="w-20 font-mono font-semibold">
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
