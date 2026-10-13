import { memo, useState, type MouseEvent } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import {
  Copy,
  CopyPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { CARD_WIDTH } from "@/shared/components/builder-canvas";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { useQueryActions } from "../lib/card-actions";
import { AddQueryMenu } from "./add-query-menu";

export interface QueryHeaderData extends Record<string, unknown> {
  query: string;
  label: string;
  name: string | null;
  kind: string;
  picked: boolean;
  current: boolean;
  /** Holds a card error, so Copy, Open and Run wait. */
  broken: boolean;
}

export type QueryHeaderNode = Node<QueryHeaderData, "query">;

const howOf = (e: MouseEvent) =>
  e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "range" : "only";

/** A query column's header: its name and kind, click to pick it, double
 *  click to rename, drag the grip to reorder, and its menu. */
export const QueryColumnHeader = memo(function QueryColumnHeader({
  data,
  dragging,
}: NodeProps<QueryHeaderNode>) {
  const { query, label, name, kind, picked, current, broken } = data;
  const actions = useQueryActions();
  const [editing, setEditing] = useState<string | null>(null);
  const fix_first = "Fix the cards with errors first";

  const commit = () => {
    if (editing === null) return;
    actions.rename(query, editing.trim() || null);
    setEditing(null);
  };

  return (
    <div
      style={{ width: CARD_WIDTH }}
      aria-label={`Query ${label}${current ? ", current" : picked ? ", picked" : ""}`}
      className={cn(
        "bg-card rounded-surface flex items-center gap-1 border py-1 pr-1 pl-1 shadow-xs",
        picked && "bg-accent",
        current && "border-primary ring-ring/60 ring-2",
        dragging && "shadow-lg",
      )}
      onClick={(e) => {
        if (
          (e.target as HTMLElement).closest(".query-drag, [role='menu'], input")
        )
          return;
        actions.pick(query, howOf(e));
      }}
    >
      <span
        className="query-drag text-muted-foreground flex cursor-grab items-center"
        title="Drag to reorder the queries"
      >
        <GripVertical className="size-3.5" />
      </span>
      {editing !== null ? (
        <Input
          autoFocus
          aria-label="Query name"
          className="nodrag h-6 min-w-0 flex-1"
          value={editing}
          placeholder={label}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(null);
          }}
        />
      ) : (
        <button
          type="button"
          className="text-body min-w-0 flex-1 truncate px-1 text-left font-semibold"
          title={`${label}. Double click to rename`}
          onDoubleClick={() => setEditing(name ?? "")}
        >
          {label}
        </button>
      )}
      <Badge variant="muted" className="font-mono">
        {kind}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="iconXs"
              className="nodrag text-muted-foreground"
              aria-label={`${label} actions`}
              title="More"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => setEditing(name ?? "")}>
            <Pencil />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.duplicate(query)}>
            <CopyPlus />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={broken}
            title={broken ? fix_first : undefined}
            onClick={() => actions.openSql(query)}
          >
            <SquareTerminal />
            Open in SQL editor
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={broken}
            title={broken ? fix_first : undefined}
            onClick={() => actions.copySql(query)}
          >
            <Copy />
            Copy SQL
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={broken}
            title={broken ? fix_first : undefined}
            onClick={() => actions.run(query)}
          >
            <Play />
            Run
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => actions.remove(query)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

export type AddQueryNode = Node<Record<string, never>, "add-query">;

/** The "+ Query" button after the last column. */
export const AddQuery = memo(function AddQuery() {
  const actions = useQueryActions();
  return (
    <AddQueryMenu
      onPick={actions.add}
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="nodrag nopan bg-background rounded-pill border-dashed"
        >
          <Plus className="size-3.5" />
          Query
        </Button>
      }
    />
  );
});
