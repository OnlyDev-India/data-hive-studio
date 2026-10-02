import { useMemo, type RefObject } from "react";
import type { GraphTable } from "@/shared/api/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/shared/components/ui/dropdown-menu";
import {
  DIAGRAM_TABLE_ACTIONS,
  TableMenuItems,
  tableMenuItems,
  type TableAction,
  type TableMenuItemProps,
} from "@/shared/components/table-menu";

export interface CanvasMenuState {
  table: GraphTable;
  /** The right click's client point. */
  x: number;
  y: number;
  open: boolean;
}

export interface CanvasMenuFlags {
  mongo: boolean;
  pg: boolean;
  readOnly: boolean;
}

function MenuItem(props: TableMenuItemProps) {
  return <DropdownMenuItem className="gap-2 px-2" {...props} />;
}

/** The sidebar's table menu, opened at the pointer on a diagram box. */
export function CanvasTableMenu({
  state,
  flags,
  onPick,
  onClose,
  returnFocus,
}: {
  state: CanvasMenuState;
  flags: CanvasMenuFlags;
  onPick: (action: TableAction) => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const { x, y, table } = state;
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        DOMRect.fromRect({ x, y, width: 0, height: 0 }),
    }),
    [x, y],
  );
  const items = tableMenuItems({
    ...flags,
    objectKind: "table",
    offer: DIAGRAM_TABLE_ACTIONS,
  });
  const name =
    table.schema && table.stub ? `${table.schema}.${table.name}` : table.name;
  return (
    <DropdownMenu
      open={state.open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DropdownMenuContent
        anchor={anchor}
        side="bottom"
        sideOffset={2}
        className="w-48"
        aria-label={`Actions for ${name}`}
        finalFocus={returnFocus}
      >
        <TableMenuItems
          items={items}
          onPick={onPick}
          Item={MenuItem}
          Separator={DropdownMenuSeparator}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
