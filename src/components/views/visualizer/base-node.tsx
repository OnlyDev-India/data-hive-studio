import React from "react";
import { cn } from "@/lib/utils";

export const BaseNode = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { selected?: boolean }
>(({ className, selected, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-md border border-foreground bg-card p-5 text-card-foreground ring-primary ring-offset-2 ring-offset-secondary",
      className,
      selected ? "shadow-lg" : "",
      "hover:ring-2",
    )}
    {...props}
  />
));
BaseNode.displayName = "BaseNode";
