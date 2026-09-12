import {
  Copy,
  CopyPlus,
  Eye,
  RefreshCw,
  ShieldCheck,
  Table as TableIcon,
  Trash2,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { IconTypeMap, type IconType } from "@/shared/components/icons/types";

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
  on_select,
  on_open,
  on_view_structure,
  on_copy,
  on_duplicate,
  on_drop,
  on_refresh_matview,
  on_view_grants,
}: {
  name: string;
  kind: string;
  is_mongo?: boolean;
  is_selected?: boolean;
  disabled?: boolean;
  on_select?: () => void;
  on_open: () => void;
  on_view_structure?: () => void;
  on_view_grants?: () => void;
  on_copy?: () => void;
  on_duplicate?: () => void;
  on_drop?: () => void;
  on_refresh_matview?: () => void;
}) {
  const noun = is_mongo ? "collection" : "table";
  const iconType: IconType =
    is_mongo || kind === "table"
      ? "table"
      : kind === "matview" || kind === "materialized_view"
        ? "layers"
        : "view";
  const icon = IconTypeMap[iconType];
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
              "w-full justify-start px-2 py-1 text-left text-xs font-normal",
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
        <ContextMenuItem onSelect={on_open}>
          <TableIcon className="text-muted-foreground size-4" />
          Open {noun}
        </ContextMenuItem>
        {on_view_structure && (
          <ContextMenuItem onSelect={on_view_structure}>
            <Eye className="text-muted-foreground size-4" />
            View structure
          </ContextMenuItem>
        )}
        {!is_mongo && on_view_grants && (
          <ContextMenuItem onSelect={on_view_grants}>
            <ShieldCheck className="text-muted-foreground size-4" />
            View grants
          </ContextMenuItem>
        )}
        {on_copy && (
          <ContextMenuItem onSelect={on_copy}>
            <Copy className="text-muted-foreground size-4" />
            Copy {noun} name
          </ContextMenuItem>
        )}
        {on_duplicate && (
          <ContextMenuItem onSelect={on_duplicate} disabled={disabled}>
            <CopyPlus className="text-muted-foreground size-4" />
            Duplicate {noun}
          </ContextMenuItem>
        )}
        {(kind === "matview" || kind === "materialized_view") &&
          on_refresh_matview && (
            <ContextMenuItem onSelect={on_refresh_matview}>
              <RefreshCw className="text-muted-foreground size-4" />
              Refresh materialized view
            </ContextMenuItem>
          )}
        {on_drop && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={on_drop}>
              <Trash2 className="size-4" />
              Drop {noun}…
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
