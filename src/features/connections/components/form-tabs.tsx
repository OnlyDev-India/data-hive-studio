import { cn } from "@/shared/lib/utils";

export type FormTabKey = "general" | "ssh" | "ssl" | "advanced";

export const FORM_TABS: { key: FormTabKey; label: string }[] = [
  { key: "general", label: "General" },
  { key: "ssh", label: "SSH" },
  { key: "ssl", label: "SSL" },
  { key: "advanced", label: "Advanced" },
];

/** Section tabs shared by the Postgres and MongoDB connection forms
 *  (General / SSH / SSL) — sits where the old per-database-type tab strip
 *  used to (top of the landing page, full width), now that the database
 *  type itself is a dropdown inside the card instead. Always rendered
 *  (even for SQLite, which only has "General") so the bar doesn't
 *  jarringly appear/disappear when switching database type — pass `tabs`
 *  to show a subset. */
export function FormTabBar({
  value,
  onChange,
  tabs = FORM_TABS,
}: {
  value: FormTabKey;
  onChange: (v: FormTabKey) => void;
  tabs?: { key: FormTabKey; label: string }[];
}) {
  return (
    <div
      role="tablist"
      className="bg-background flex w-full shrink-0 scrollbar-none items-center gap-1 overflow-x-auto border-b pl-1.5 [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm whitespace-nowrap",
            value === t.key
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
