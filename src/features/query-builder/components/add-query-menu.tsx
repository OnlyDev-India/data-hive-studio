import type { ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import type { NewQueryKind } from "../lib/model";

const KINDS: { kind: NewQueryKind; label: string; hint: string }[] = [
  {
    kind: "select",
    label: "SELECT",
    hint: "read rows, previewed card by card",
  },
  { kind: "update", label: "UPDATE", hint: "change rows" },
  { kind: "delete", label: "DELETE", hint: "remove rows" },
  { kind: "insert", label: "INSERT", hint: "add rows" },
  {
    kind: "upsert",
    label: "Upsert",
    hint: "add rows, or update them on a key",
  },
];

/** What "+ Query" adds: a SELECT, a write query, or a SQL statement. */
export function AddQueryMenu({
  trigger,
  onPick,
}: {
  trigger: ReactElement;
  onPick: (kind: NewQueryKind) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align="start" className="w-72">
        {KINDS.map((k) => (
          <DropdownMenuItem key={k.kind} onClick={() => onPick(k.kind)}>
            <span className="w-16 shrink-0 font-mono font-semibold">
              {k.label}
            </span>
            <span className="text-muted-foreground text-small truncate">
              {k.hint}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onPick("statement")}>
          <span className="w-16 shrink-0 font-mono font-semibold">SQL</span>
          <span className="text-muted-foreground text-small truncate">
            any other statement, kept as written
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
