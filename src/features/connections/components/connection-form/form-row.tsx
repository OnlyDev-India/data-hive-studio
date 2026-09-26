import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";
import { InfoTip } from "../info-tip";

/** Label on the left and field on the right; stacked in a narrow card. */
export function FormRow({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
  disabled,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  /** Shown on hover of an info icon beside the label. */
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Dims the label; the field disables itself. */
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-1.5 @[30rem]:grid-cols-[8rem_1fr] @[30rem]:gap-x-4",
        className,
      )}
    >
      <div className="flex items-center gap-1 @[30rem]:h-7 @[30rem]:justify-end">
        <Label
          htmlFor={htmlFor}
          className={cn(
            "text-foreground/90 text-sm font-medium @[30rem]:text-right",
            disabled && "opacity-50",
          )}
        >
          {label}
        </Label>
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </div>
      <div className="grid min-w-0 gap-1">
        {children}
        {error && (
          <p
            id={htmlFor ? `${htmlFor}-msg` : undefined}
            role="alert"
            className="text-destructive text-xs"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** A row with no label of its own, lined up under the field column. */
export function FormRowPlain({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid @[30rem]:grid-cols-[8rem_1fr] @[30rem]:gap-x-4">
      <div aria-hidden className="hidden @[30rem]:block" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
