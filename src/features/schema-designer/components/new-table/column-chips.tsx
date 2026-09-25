import { cn } from "@/shared/lib/utils";

/** Pick any number of the table's columns, one toggle each. */
export function ColumnChips({
  columns,
  value,
  onChange,
}: {
  columns: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  // A chosen column that was renamed or removed still shows, so it can be
  // unticked instead of silently lingering.
  const all = [...columns, ...value.filter((v) => !columns.includes(v))];
  if (all.length === 0)
    return (
      <span className="text-muted-foreground text-xs">No columns yet</span>
    );
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? value.filter((v) => v !== c) : [...value, c])
            }
            className={cn(
              "rounded-md border px-2 py-0.5 font-mono text-xs",
              on
                ? "bg-accent text-accent-foreground border-foreground/40"
                : "text-muted-foreground",
              !columns.includes(c) && "border-destructive text-destructive",
            )}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
