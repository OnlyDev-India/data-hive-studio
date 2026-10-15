import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

/** A simple MariaDB mark in the brand's navy and copper (spec 0025 AC-1). */
const MariaDbIcon = ({ size, className, ...props }: IconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size ?? "24"}
      height={size ?? "24"}
      viewBox="0 0 128 128"
      fill="currentColor"
      className={cn("size-6", className)}
      {...props}
    >
      <rect x="8" y="8" width="112" height="112" rx="24" fill="#003545" />
      <path
        fill="#C0765A"
        d="M30 94V36h14l20 30 20-30h14v58H84V60L66 86h-4L44 60v34z"
      />
    </svg>
  );
};

export default MariaDbIcon;
