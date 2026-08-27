import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

interface PanelRightIconProps extends IconProps {
  isOpen?: boolean;
}

const PanelRightIcon = ({
  size,
  className,
  isOpen = false,
}: PanelRightIconProps) => {
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
        "lucide lucide-panel-right-icon lucide-panel-right",
        className,
      )}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />

      {/* Right panel */}
      <rect
        x="15"
        y="3"
        width="6"
        height="18"
        rx="0"
        fill={isOpen ? "currentColor" : "none"}
        stroke="none"
      />

      {/* Divider */}
      <path d="M15 3v18" />
    </svg>
  );
};

export default PanelRightIcon;
