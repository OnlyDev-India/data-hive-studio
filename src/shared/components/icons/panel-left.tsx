import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

interface PanelLeftIconProps extends IconProps {
  isOpen?: boolean;
}

const PanelLeftIcon = ({
  size,
  className,
  isOpen = false,
}: PanelLeftIconProps) => {
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
      className={cn(
        "lucide lucide-panel-left-icon lucide-panel-left",
        className,
      )}
    >
      {/* Outer panel */}
      <rect width="18" height="18" x="3" y="3" rx="2" />

      {/* Left panel */}
      <rect
        x="3"
        y="3"
        width="6"
        height="18"
        fill="currentColor"
        className={cn(
          "transition-opacity",
          isOpen ? "opacity-100" : "opacity-0",
        )}
        stroke="none"
      />

      {/* Divider */}
      <path d="M9 3v18" />
    </svg>
  );
};

export default PanelLeftIcon;
