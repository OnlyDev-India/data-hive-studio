import { useRef } from "react";
import { cn } from "@/shared/lib/utils";
import type { FormTabKey } from "../../lib/tab-fields";

export type TabDot = "changed" | "error" | null;

export function CardTabs({
  tabs,
  value,
  onChange,
  dots,
  idPrefix,
}: {
  tabs: { key: FormTabKey; label: string }[];
  value: FormTabKey;
  onChange: (tab: FormTabKey) => void;
  dots: Partial<Record<FormTabKey, TabDot>>;
  idPrefix: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    let next: number | undefined;
    if (step) next = (i + step + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Connection settings"
      className="bg-muted inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg p-0.5"
    >
      {tabs.map((t, i) => {
        const selected = t.key === value;
        const dot = dots[t.key];
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "focus-visible:ring-ring/50 relative flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs whitespace-nowrap outline-none focus-visible:ring-[3px]",
              selected
                ? "bg-background text-foreground font-medium shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {dot && (
              <span
                aria-label={dot === "error" ? "has a problem" : "changed"}
                className={cn(
                  "size-1.5 rounded-full",
                  dot === "error" ? "bg-destructive" : "bg-muted-foreground/70",
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
