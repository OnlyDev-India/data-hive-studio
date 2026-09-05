import { cn } from "@/shared/lib/utils";
import type { IconProps } from "./types";

interface PanelRightIconProps extends IconProps {
  isOpen?: boolean;
}

const PanelRightIcon = ({
  size,
  className,
  active,
  isOpen = false,
  ...props
}: PanelRightIconProps) => {
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
        "lucide lucide-panel-right-icon lucide-panel-right",
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
        className={cn("fill-transparent stroke-2 stroke-muted-foreground", {
          "fill-primary/60": active,
        })}
      />

      {/* Right panel */}
      <rect
        x={"11"}
        y="5"
        width={"8"}
        height="14"
        rx="2"
        stroke="2"
        className={cn(
          "fill-muted-foreground transition-opacity",
          isOpen ? "opacity-100" : "opacity-60",
          { "fill-primary": active },
        )}
      />

      {/* Divider */}
      <path d="M15 3v18" stroke="2" className="fill-red-500"/>
    </svg>
  );
};

export default PanelRightIcon;
