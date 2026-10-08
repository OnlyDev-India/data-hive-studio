import { useState, type ReactElement } from "react";
import { Link2 } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { useTables } from "../lib/card-actions";
import type { JoinSuggestion } from "../lib/joins";
import type { PickTable } from "../lib/use-catalog";

const label = (t: PickTable, home: string | null) =>
  t.schema && t.schema !== home ? `${t.schema}.${t.name}` : t.name;

/** A searchable list of tables, the tab's schema first; for a JOIN, the
 *  tables linked by a foreign key come before all of them. */
export function TablePicker({
  trigger,
  onPick,
  suggestions = [],
}: {
  trigger: ReactElement;
  onPick: (t: PickTable, suggestion?: JoinSuggestion) => void;
  suggestions?: JoinSuggestion[];
}) {
  const { tables, home, loadOtherSchemas } = useTables();
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) loadOtherSchemas();
      }}
    >
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-80 p-0">
        <Command loop>
          <CommandInput placeholder="Find a table…" autoFocus />
          <CommandList>
            <CommandEmpty>No table matches.</CommandEmpty>
            {suggestions.length > 0 && (
              <CommandGroup heading="Linked by a foreign key">
                {suggestions.map((s, i) => (
                  <CommandItem
                    key={`s${i}`}
                    value={`fk ${label(s.table, home)} ${s.on.map((p) => p.left).join(" ")}`}
                    onSelect={() => {
                      setOpen(false);
                      onPick(s.table, s);
                    }}
                  >
                    <Link2 className="text-muted-foreground size-3" />
                    <span className="font-mono">{label(s.table, home)}</span>
                    <span className="text-muted-foreground text-caption ml-auto truncate font-mono">
                      {s.on.map((p) => `${p.left} = ${p.right}`).join(", ")}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Tables">
              {tables.map((t) => (
                <CommandItem
                  key={`${t.schema ?? ""}.${t.name}`}
                  value={label(t, home)}
                  onSelect={() => {
                    setOpen(false);
                    onPick(t);
                  }}
                >
                  <span className="font-mono">{label(t, home)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
