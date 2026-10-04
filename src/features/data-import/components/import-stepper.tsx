import { Check } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export const STEPS = ["Source", "Options", "Mapping", "Review", "Run"] as const;
export type StepName = (typeof STEPS)[number];

/** The five stages of an import, with the finished ones ticked. */
export function ImportStepper({ current }: { current: StepName }) {
  const at = STEPS.indexOf(current);
  return (
    <ol className="bg-accent/40 rounded-surface flex border px-4 py-3">
      {STEPS.map((name, i) => (
        <li
          key={name}
          className="relative flex flex-1 flex-col items-center gap-1.5"
          aria-current={i === at ? "step" : undefined}
        >
          {i > 0 && (
            <span
              aria-hidden
              className="bg-border absolute top-3 right-1/2 h-px w-full"
            />
          )}
          <span
            className={cn(
              "bg-background text-small relative flex size-6 items-center justify-center rounded-full border font-medium",
              i === at && "bg-foreground text-background border-transparent",
              i > at && "text-muted-foreground",
            )}
          >
            {i < at ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span
            className={cn(
              "text-body",
              i === at ? "font-medium" : "text-muted-foreground",
            )}
          >
            {name}
          </span>
        </li>
      ))}
    </ol>
  );
}
