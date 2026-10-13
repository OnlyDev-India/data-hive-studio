import { Fragment, type ComponentType, type ReactNode } from "react";
import type { MenuEntry } from "./table-menu-items";

export interface TableMenuItemProps {
  onClick: () => void;
  disabled: boolean;
  title?: string;
  variant: "default" | "destructive";
  children: ReactNode;
}

/** Draws `items` with the surface's own menu item and separator. */
export function MenuItems<A extends string>({
  items,
  onPick,
  Item,
  Separator,
}: {
  items: MenuEntry<A>[];
  onPick: (action: A) => void;
  Item: ComponentType<TableMenuItemProps>;
  Separator: ComponentType;
}) {
  return items.map((it) => {
    const Icon = it.icon;
    return (
      <Fragment key={it.action}>
        {it.separatorBefore && <Separator />}
        <Item
          onClick={() => onPick(it.action)}
          disabled={it.disabled}
          title={it.title}
          variant={it.destructive ? "destructive" : "default"}
        >
          <Icon
            className={
              it.destructive ? "size-4" : "text-muted-foreground size-4"
            }
          />
          {it.label}
        </Item>
      </Fragment>
    );
  });
}

export const TableMenuItems = MenuItems;
