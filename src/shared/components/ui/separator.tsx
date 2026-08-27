import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@/shared/lib/utils";

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorPrimitive.Props & { decorative?: boolean }) {
  void decorative;
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "bg-border shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
