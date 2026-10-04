import { useState } from "react";
import { Blocks, PanelLeftClose, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { OPERATORS } from "../lib/operators";

/** The drag payload type a palette item carries. */
export const STAGE_MIME = "application/x-dh-stage-op";

/** Every operator, to drag onto a link (insert there) or the canvas (add at
 *  the end). Clicking one adds it at the end too, for the keyboard. */
export function StagePalette({
  onAdd,
  canAdd,
}: {
  onAdd: (op: string) => void;
  /** Whether an operator can go at the end of the chain. */
  canAdd: (op: string) => boolean;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  if (!open)
    return (
      <Button
        variant="outline"
        size="sm"
        className="bg-background absolute top-2 left-2 z-10"
        onClick={() => setOpen(true)}
      >
        <Blocks className="size-3.5" />
        Stages
      </Button>
    );
  const q = query.trim().toLowerCase();
  const shown = OPERATORS.filter(
    (o) =>
      !q ||
      o.op.toLowerCase().includes(q) ||
      o.description.toLowerCase().includes(q),
  );
  return (
    <aside
      aria-label="Stage palette"
      className="bg-background rounded-surface absolute top-2 left-2 z-10 flex max-h-[calc(100%-10.5rem)] w-52 flex-col border shadow-xs"
    >
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-2">
        <span className="text-small text-muted-foreground font-medium">
          Stages
        </span>
        <Button
          variant="ghost"
          size="iconXs"
          className="text-muted-foreground ml-auto"
          aria-label="Hide the stage palette"
          title="Hide"
          onClick={() => setOpen(false)}
        >
          <PanelLeftClose className="size-3.5" />
        </Button>
      </div>
      <label className="flex items-center gap-1.5 border-b px-2">
        <Search className="text-muted-foreground size-3" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a stage…"
          aria-label="Find a stage"
          className="text-small placeholder:text-muted-foreground h-7 min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.map((o) => {
          const ok = canAdd(o.op);
          return (
            <li key={o.op}>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(STAGE_MIME, o.op);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => ok && onAdd(o.op)}
                aria-disabled={!ok}
                title={
                  ok
                    ? `${o.description}. Drag onto a link, or click to add at the end.`
                    : "A stage that writes is already last"
                }
                className={cn(
                  "hover:bg-accent rounded-control flex w-full cursor-grab flex-col items-start px-2 py-1 text-left active:cursor-grabbing",
                  !ok && "opacity-50",
                )}
              >
                <span className="text-small font-mono">{o.op}</span>
                <span className="text-muted-foreground text-caption line-clamp-1">
                  {o.description}
                </span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-muted-foreground text-small px-2 py-1">
            No stage by that name.
          </li>
        )}
      </ul>
    </aside>
  );
}
