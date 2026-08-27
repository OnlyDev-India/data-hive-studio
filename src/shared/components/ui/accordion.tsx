import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("w-full", className)}
      {...props}
    />
  );
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("bg-card rounded-md border last:border-b", className)}
      {...props}
    />
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header data-slot="accordion-header" className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group hover:bg-muted/50 focus-visible:ring-ring/50 flex flex-1 items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          className="text-muted-foreground size-4 shrink-0 transition-transform duration-200 group-data-panel-open:rotate-180"
          aria-hidden
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

function AccordionPanel({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-panel"
      className={cn(
        "data-open:animate-in data-open:fade-in-0 overflow-hidden text-sm data-closed:hidden",
        className,
      )}
      {...props}
    >
      {children}
    </AccordionPrimitive.Panel>
  );
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionPanel };
