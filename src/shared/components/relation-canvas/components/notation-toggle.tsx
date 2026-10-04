import { cn } from "@/shared/lib/utils";

/** Relation view draws tables as boxes; ER view is the Chen style drawing. */
export type Notation = "relation" | "er";

const OPTIONS: { value: Notation; label: string; hint: string }[] = [
  {
    value: "relation",
    label: "Relation",
    hint: "Tables as boxes joined by their keys",
  },
  {
    value: "er",
    label: "ER",
    hint: "Entities, attributes and relationships with cardinality",
  },
];

export function NotationToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: Notation;
  onChange: (n: Notation) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Diagram notation"
      className="bg-muted/60 rounded-control flex items-center p-0.5"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-inset text-small focus-visible:ring-ring/50 h-6 px-2 outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
            value === o.value
              ? "bg-background text-foreground font-medium shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
