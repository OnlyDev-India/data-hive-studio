import type { KeyboardEvent, ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  MenuItems,
  type MenuEntry,
  type TableMenuItemProps,
} from "../table-menu";

/** Adapts the shared renderer's item props to the context menu item. */
export function ContextMenuEntry({ onClick, ...rest }: TableMenuItemProps) {
  return <ContextMenuItem onSelect={onClick} {...rest} />;
}

/** Shift+F10 or the Menu key opens the row's menu, anchored at the row, by
 *  sending the same `contextmenu` event a right click does. */
export function openMenuFromKey(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
  e.preventDefault();
  e.stopPropagation();
  const el = e.target as HTMLElement;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: r.left,
      clientY: r.bottom,
    }),
  );
}

/** Wraps a tree row in its right click menu. */
export function TreeRowMenu<A extends string>({
  items,
  onPick,
  children,
}: {
  items: MenuEntry<A>[];
  onPick: (action: A) => void;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents" onKeyDown={openMenuFromKey}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <MenuItems
          items={items}
          onPick={onPick}
          Item={ContextMenuEntry}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
