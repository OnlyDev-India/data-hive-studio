import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  TableMenuItems,
  tableMenuItems,
  type TableAction,
  type TableMenuItemProps,
} from "@/shared/components/table-menu";
import { IconTypeMap, type IconType } from "@/shared/components/icons/types";

function MenuItem({ onClick, ...rest }: TableMenuItemProps) {
  return <ContextMenuItem onSelect={onClick} {...rest} />;
}

/** One table/view/matview/collection row — used for both the connection's
 *  own active database AND any sibling database/schema, with whichever
 *  actions the caller can actually target for that row (all optional but
 *  `on_open`, so a sibling list can offer a smaller menu). */
export function TableListItem({
  name,
  kind,
  is_mongo = false,
  is_selected,
  disabled,
  read_only = false,
  on_select,
  on_open,
  on_view_structure,
  on_copy,
  on_duplicate,
  on_import,
  on_drop,
  on_refresh_matview,
  on_view_grants,
  on_compare,
}: {
  name: string;
  kind: string;
  is_mongo?: boolean;
  is_selected?: boolean;
  disabled?: boolean;
  /** The connection is read only (spec 0007): the items that change data or
   *  schema are disabled, with the reason as a tooltip. */
  read_only?: boolean;
  on_select?: () => void;
  on_open: () => void;
  on_view_structure?: () => void;
  /** Postgres only: the caller leaves it out elsewhere. */
  on_view_grants?: () => void;
  on_copy?: () => void;
  on_duplicate?: () => void;
  on_import?: () => void;
  on_drop?: () => void;
  on_refresh_matview?: () => void;
  on_compare?: () => void;
}) {
  const iconType: IconType =
    is_mongo || kind === "table"
      ? "table"
      : kind === "matview" || kind === "materialized_view"
        ? "layers"
        : "view";
  const icon = IconTypeMap[iconType];
  const handlers: Record<TableAction, (() => void) | undefined> = {
    open: on_open,
    structure: on_view_structure,
    compare: on_compare,
    grants: on_view_grants,
    copy: on_copy,
    duplicate: on_duplicate,
    import: on_import,
    refresh_matview: on_refresh_matview,
    drop: on_drop,
  };
  const offer = new Set(
    (Object.keys(handlers) as TableAction[]).filter((a) => handlers[a]),
  );
  const items = tableMenuItems({
    mongo: is_mongo,
    pg: !is_mongo,
    objectKind: kind,
    readOnly: read_only,
    busy: disabled,
    offer,
  });
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Button
            variant="ghost"
            data-table={name}
            onClick={on_select}
            onDoubleClick={on_open}
            className={cn(
              "text-small w-full justify-start px-2 py-1 text-left font-normal",
              is_selected ? "bg-muted font-medium" : "hover:bg-muted/50",
            )}
          >
            {icon}
            <span className="truncate font-medium">{name}</span>
            <span className="sr-only">{kind}</span>
          </Button>
        }
      />
      <ContextMenuContent className="w-48">
        <TableMenuItems
          items={items}
          onPick={(a) => handlers[a]?.()}
          Item={MenuItem}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
