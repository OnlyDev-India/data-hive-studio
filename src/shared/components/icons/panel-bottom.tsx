import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

interface PanelBottomIconProps extends IconProps {
  isOpen?: boolean;
}

const PanelBottomIcon = ({
  size,
  className,
  active,
  isOpen = false,
  ...props
}: PanelBottomIconProps) => {
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
        "lucide lucide-panel-bottom-icon lucide-panel-bottom",
        className,
      )}
      {...props}
    >
      <rect
        width="18"
        height="18"
        x="3"
        y="3"
        rx="2"
        className={cn("stroke-muted-foreground fill-transparent stroke-2", {
          "fill-primary/60": active,
        })}
      />

      {/* Bottom panel */}
      <rect
        x="5"
        y="11"
        width="14"
        height="8"
        rx="2"
        stroke="2"
        className={cn(
          "fill-muted-foreground transition-opacity",
          isOpen ? "opacity-100" : "opacity-60",
          { "fill-primary": active },
        )}
      />

      {/* Divider */}
      <path d="M3 15h18" stroke="2" className="fill-red-500" />
    </svg>
  );
};

export default PanelBottomIcon;
