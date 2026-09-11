import {
  Select,
  SelectItem,
  SelectContent,
  SelectGroup,
  SelectTrigger,
  SelectValue,
  Button,
} from "@/shared/components/ui";
import { PlayIcon, TextCursorInput, TextSelect } from "lucide-react";
import { DBIcons, type DbIconKind } from "@/shared/components/icons/types";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

/** Run controls + (for Postgres/Mongo) a database picker — shared by the
 *  SQL and Mongo console bodies, rendered above the editor itself rather
 *  than in the global action bar, so which database a run targets is right
 *  next to the button that runs it. No separate schema picker: a
 *  non-default Postgres schema is named straight in the query text
 *  (`schema.table`) instead — see `schemaCompletions`'s doc comment in
 *  `sql-completions.ts` for why, and how hints still work for it. */
export function EditorRunToolbar({
  has_selection,
  can_run_target,
  has_text,
  on_run_target,
  on_run_all,
  db_kind,
  database,
  databases,
  on_database_change,
}: {
  has_selection: boolean;
  can_run_target: boolean;
  has_text: boolean;
  on_run_target: () => void;
  on_run_all: () => void;
  /** Drives the colored connection-type icon next to the database picker. */
  db_kind?: DbIconKind;
  /** Omitted entirely (both `databases` and `on_database_change` absent) =
   *  no database concept to switch (SQLite). */
  database?: string;
  databases?: string[];
  on_database_change?: (v: string) => void;
}) {
  const DbIcon = db_kind ? DBIcons[db_kind] : null;
  return (
    <TooltipProvider delay={500}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1">
        <div className="flex items-center">
          <Tooltip >
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 bg-transparent px-2 text-xs text-[#A4F4D0]! hover:bg-[#2E4D48]"
                  disabled={!can_run_target}
                  title={
                    has_selection
                      ? "Run the selected statement(s)"
                      : "Run the query at the cursor"
                  }
                  onClick={on_run_target}
                >
                  {has_selection ? (
                    <TextSelect className="size-3.5" />
                  ) : (
                    <TextCursorInput className="size-3.5" />
                  )}
                </Button>
              }
            />
            <TooltipContent side="top">
              {has_selection
                ? "Run the selected statement(s)"
                : "Run the query at the cursor"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 bg-transparent px-2 text-xs hover:bg-success/20"
                  disabled={!has_text}
                  title="Run all statements"
                  onClick={on_run_all}
                >
                  <PlayIcon className="text-success size-3.5" />
                </Button>
              }
            />
            <TooltipContent side="top">Run all</TooltipContent>
          </Tooltip>
        </div>
        {databases && databases.length > 0 && on_database_change && (
          <div className="flex items-center">
            <Select
              key={database}
              value={database || undefined}
              onValueChange={(v) => v && on_database_change(v)}
            >
              <SelectTrigger size="sm" className="h-6! border-none text-xs dark:bg-transparent">
                {DbIcon && <DbIcon className="size-4 shrink-0" />}
                <SelectValue>{() => database}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {databases.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
