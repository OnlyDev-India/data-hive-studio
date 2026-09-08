import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

/** shadcn/ui's Input Group primitive, trimmed to the leading/trailing-addon
 *  case this app needs (a browse button living inside a path field) — drops
 *  `InputGroupTextarea`/block-start/block-end alignment/`InputGroupText`
 *  from the upstream version since nothing here uses them yet; add them
 *  back the same way (see shadcn's `input-group` registry entry) if a
 *  future field needs one. */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group border-input relative flex h-9 w-full min-w-0 items-center rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] outline-none",
        "has-[>[data-align=inline-start]]:[&>input]:pl-2",
        "has-[>[data-align=inline-end]]:[&>input]:pr-2",
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot=input-group-control]:focus-visible]:ring-2",
        "has-[[data-slot=input-group-control]:disabled]:pointer-events-none has-[[data-slot=input-group-control]:disabled]:cursor-not-allowed has-[[data-slot=input-group-control]:disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium select-none [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-3 has-[>button]:ml-[-0.45rem]",
        "inline-end": "order-last pr-3 has-[>button]:mr-[-0.45rem]",
      },
    },
    defaultVariants: { align: "inline-start" },
  },
);

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      }}
      {...props}
    />
  );
}

/** Uses this app's own `Button` size tokens (`iconXs`/`iconSm`/`sm`, …)
 *  rather than upstream shadcn's `icon-xs`/`icon-sm` — same idea, this
 *  project's existing naming. */
function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "iconXs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      className={cn("shadow-none", className)}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0",
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput };
