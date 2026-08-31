import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

export function HouseIcon({
  className,
  active,
  disabled,
  ...props
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="0"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5", className)}
      {...props}
    >
      <path
        d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        className={cn(
          "fill-muted-foreground/60",
          { "fill-primary/60": active },
          { "hover:fill-primary/60 group-hover:fill-primary/60": !disabled },
        )}
      />

      <path
        d="M9 21v-8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v8"
        className={cn(
          "fill-muted-foreground stroke-primary",
          { "fill-primary": active },
          { "hover:fill-primary group-hover:fill-primary": !disabled },
        )}
      />
    </svg>
  );
}
