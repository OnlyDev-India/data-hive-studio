import { useState, type ReactElement } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { isWriteOp, OPERATORS } from "../lib/operators";

/** A searchable list of stage operators, each with a one line description,
 *  opened from `trigger`. */
export function OperatorMenu({
  trigger,
  onPick,
  current,
  allowWrite = false,
}: {
  trigger: ReactElement;
  onPick: (op: string) => void;
  /** The card's own operator, marked in the list. */
  current?: string;
  /** Offer `$out` and `$merge`, which only go last in the chain. */
  allowWrite?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const offered = allowWrite
    ? OPERATORS
    : OPERATORS.filter((o) => !isWriteOp(o.op));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-80 p-0">
        <Command loop>
          <CommandInput placeholder="Find a stage…" autoFocus />
          <CommandList className="max-h-72">
            <CommandEmpty>No stage by that name.</CommandEmpty>
            {offered.map((o) => (
              <CommandItem
                key={o.op}
                value={o.op}
                keywords={[o.description]}
                onSelect={() => {
                  onPick(o.op);
                  setOpen(false);
                }}
                className="flex-col items-start gap-0.5"
              >
                <span className="text-body font-mono">
                  {o.op}
                  {o.op === current && (
                    <span className="text-muted-foreground text-caption ml-2 font-sans">
                      current
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground text-small">
                  {o.description}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
