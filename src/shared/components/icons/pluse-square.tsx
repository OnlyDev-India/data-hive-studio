import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

export function SquarePlusIcon({
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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5", className)}
      {...props}
    >
      <rect
        width="18"
        height="18"
        x="3"
        y="3"
        rx="4"
        className={cn(
          "stroke-muted-foreground",
          {
            "stroke-primary": active,
          },
          {
            "hover:stroke-primary group-hover:stroke-primary":
              !disabled,
          },
        )}
      />
      <path
        d="M8 12h8"
        className={cn(
          "stroke-muted-foreground",
          { "stroke-primary": active },
          { "hover:stroke-primary group-hover:stroke-primary": !disabled },
        )}
      />
      <path
        d="M12 8v8"
        className={cn(
          "stroke-muted-foreground",
          { "stroke-primary": active },
          { "hover:stroke-primary group-hover:stroke-primary": !disabled },
        )}
      />
    </svg>
  );
}
