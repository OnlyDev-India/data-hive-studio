import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/shared/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  align = "center",
  sideOffset = 4,
  showArrow = false,
  children,
  ...props
}: TooltipPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  showArrow?: boolean;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        data-slot="tooltip-positioner"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "bg-foreground text-background z-50 w-max max-w-[calc(100vw-2rem)] rounded-md px-3 py-1.5 text-xs shadow-md",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 duration-100",
            className,
          )}
          {...props}
        >
          {children}
          {showArrow && (
            <TooltipPrimitive.Arrow className="bg-foreground block size-1.5 translate-x-[-50%] rotate-45" />
          )}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
