/** Small label and value tiles used by the Mapping and Review steps. */
export function SummaryCards({
  items,
  cols = 3,
}: {
  items: [label: string, value: string][];
  cols?: 2 | 3;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-3 ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
    >
      {items.map(([label, value]) => (
        <div
          key={label}
          className="bg-accent/40 min-w-0 rounded-lg border px-3 py-2"
        >
          <div className="text-muted-foreground text-xs">{label}</div>
          <div className="truncate text-sm font-medium" title={value}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}
