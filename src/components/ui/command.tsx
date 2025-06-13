"use client";

import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full flex-col overflow-hidden rounded-md border border-border/50 bg-background/70 bg-[radial-gradient(circle_at_top_left,#21b45910_0%,transparent_50%),radial-gradient(circle_at_bottom_right,#21b45910_0%,transparent_50%)] text-popover-foreground backdrop-blur-xl",
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

interface CommandDialogProps extends DialogProps {
  className?: string;
  filter?: (
    value: string,
    search: string,
    keywords?: string[] | undefined,
  ) => number;
  isCloseButton?: boolean,
}

const CommandDialog = ({
  children,
  className,
  filter,
  isCloseButton = true,
  ...props
}: CommandDialogProps) => {
  return (
    <Dialog {...props}>
      <DialogHeader>
        <DialogTitle className="hidden">hi</DialogTitle>
        <DialogDescription className="hidden">hi</DialogDescription>
      </DialogHeader>
      <DialogContent isCloseButton={isCloseButton} className={cn("overflow-hidden p-0", className)}>
        <Command
          filter={filter}
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

interface CommandInputProps
  extends React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> {
  isIcon?: boolean;
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, isIcon = true, ...props }, ref) => {
  // Custom ref to access the input element
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Merge forwarded ref and local ref
  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  // Prevent selection of all text on focus if there is a value
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (inputRef.current && inputRef.current.value) {
      // Use setTimeout to override browser's default selection after focus
      setTimeout(() => {
        const len = inputRef.current!.value.length;
        inputRef.current!.setSelectionRange(len, len);
      }, 0);
    }
    if (props.onFocus) props.onFocus(e);
  };

  return (
    <div
      className="flex items-center border-b bg-background px-3"
      cmdk-input-wrapper=""
    >
      {isIcon && <Search className="mr-2 size-3 shrink-0 opacity-50" />}
      <CommandPrimitive.Input
        ref={inputRef}
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        onFocus={handleFocus}
        {...props}
      />
    </div>
  );
});

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm"
    {...props}
  />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-md px-3 py-1.5 text-xs outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
