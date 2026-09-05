import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

interface PanelLeftIconProps extends IconProps {
  isOpen?: boolean;
}

const PanelLeftIcon = ({
  size,
  className,
  active,
  isOpen = false,
  ...props
}: PanelLeftIconProps) => {
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
      className={cn(
        "lucide lucide-panel-left-icon lucide-panel-left",
        className,
      )}
      {...props}
    >
      {/* Outer panel */}
      <rect
        width="18"
        height="18"
        x="3"
        y="3"
        rx="2"
        className={cn("fill-transparent stroke-2 stroke-muted-foreground", {
          "fill-primary/60": active,
        })}
      />

      {/* Left panel */}
      <rect
        x={"6"}
        y="5"
        width={"8"}
        height="14"
        rx="2"
        className={cn(
          "fill-muted-foreground transition-opacity",
          isOpen ? "opacity-100" : "opacity-60",
          { "fill-primary": active },
        )}
        stroke="none"
      />

      {/* Divider */}
      <path d="M9 3v18" />
    </svg>
  );
};

export default PanelLeftIcon;
