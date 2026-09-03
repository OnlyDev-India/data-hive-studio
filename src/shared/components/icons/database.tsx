import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

export function DatabaseIcon({
  className,
  active,
  disabled,
  size,
  ...props
}: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size ?? "24"}
      height={size ?? "24"}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="0"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5", className)}
      {...props}
    >
      {/* Database body */}
      <path
        d="M3 5V19A9 3 0 0 0 21 19V5"
        className={cn(
          "fill-muted-foreground/50",
          {
            "fill-primary/50": active,
          },
          { "hover:fill-primary/50 group-hover:fill-primary/50": !disabled },
        )}
      />

      {/* Top layer */}
      <ellipse
        cx="12"
        cy="5"
        rx="9"
        ry="3"
        className={cn(
          "fill-muted-foreground/80",
          {
            "fill-primary/80": active,
          },
          { "hover:fill-primary/80 group-hover:fill-primary/80": !disabled },
        )}
      />

      {/* Middle layer */}
      <path
        d="M3 12A9 3 0 0 0 21 12"
        className={cn(
          "stroke-muted-foreground stroke-2",
          {
            "stroke-primary": active,
          },
          { "hover:stroke-primary group-hover:stroke-primary": !disabled },
        )}
      />
    </svg>
  );
}
