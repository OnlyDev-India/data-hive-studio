import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@/shared/components/ui/button";

/** Shrink slots, left to right: a tab's own button, Refresh, Export. */
export const CANVAS_SHRINK_SLOTS = 3;

/** One flag per shrink slot, true once the pane is too narrow for its label. */
export const CanvasCompact = createContext<boolean[]>([]);

/** A labeled toolbar button that turns icon only in a narrow pane. Lower
 *  `shrink` slots go icon only first, like the grid toolbar. */
export function CanvasButton({
  icon,
  label,
  title,
  shrink,
  variant = "ghost",
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "size"> & {
  icon: ReactNode;
  label: string;
  shrink: number;
}) {
  const compact = useContext(CanvasCompact)[shrink] ?? false;
  return (
    <Button
      size={compact ? "iconXs" : "sm"}
      variant={variant}
      aria-label={label}
      title={title ?? label}
      {...props}
    >
      {icon}
      {!compact && label}
    </Button>
  );
}
