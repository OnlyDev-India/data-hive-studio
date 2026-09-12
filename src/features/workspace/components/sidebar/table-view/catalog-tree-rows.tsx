import { useState } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { IconTypeMap, type IconType } from "@/shared/components/icons/types";
import type { SchemaObject } from "@/shared/api";
import { depthPadding } from "./catalog-tree-utils";
import { TableListItem } from "./table-list-item";

/** A collapsible tree row — database/schema/category/roles headers all
 *  share this same chevron-disclosure shape (see `tree_expanded`/
 *  `toggle_tree` in `TablesBrowser`). */
export function TreeToggleRow({
  icon_badge = false,
  label,
  suffix,
  expanded,
  disabled,
  depth,
  active,
  onClick,
  trailing,
  chevron = true,
  loading = false,
  kind = "table",
}: {
  kind: IconType;
  /** Small green dot overlaid on the icon's corner — the "connected"
   *  indicator, on the icon itself rather than a separate trailing dot
   *  (the trailing slot is used for the disconnect/close button instead). */
  icon_badge?: boolean;
  label: React.ReactNode;
  /** Extra content on the right, INSIDE the button itself (unlike
   *  `trailing`, which sits outside it as a separate sibling — a small
   *  static label like "Default" belongs here since it isn't its own
   *  interactive control). */
  suffix?: React.ReactNode;
  expanded: boolean;
  disabled?: boolean;
  depth: number;
  /** Highlights the row (bold, foreground text) — the connection's
   *  currently-active database/schema. */
  active?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
  /** False for rows that open something (a tab) instead of expanding
   *  inline — no disclosure chevron, since there's nothing to disclose. */
  chevron?: boolean;
  /** This node's children are being lazily fetched — the chevron becomes a
   *  spinner in place instead of a separate "Loading…" line inside the
   *  expanded content, so the row itself is the loading indicator. */
  loading?: boolean;
}) {
  const icon = IconTypeMap[kind];
  return (
    <div className="group/row flex items-center gap-0.5">
      <Button
        variant={"ghost"}
        type="button"
        disabled={disabled}
        aria-expanded={expanded}
        onClick={onClick}
        style={depthPadding(depth)}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center justify-start gap-1.5 rounded py-1 text-left disabled:opacity-50",
          active
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        {chevron &&
          (loading ? (
            <Loader2 className="size-3 shrink-0 animate-spin" />
          ) : (
            <ChevronRight
              className={cn(
                "size-3 shrink-0 transition-transform",
                expanded && "rotate-90",
              )}
            />
          ))}
        {icon && (
          <span
            className={cn("relative inline-flex shrink-0", {
              // Only the database icon's color is tied to connection state
              // (gray when disconnected, its real color once connected) —
              // every other kind (schema, roles, table/view/procedure/…)
              // always shows its own semantic color, at any depth.
              "[&>svg]:text-muted-foreground":
                kind === "database" && !icon_badge,
            })}
          >
            {icon}
            {icon_badge && (
              <span
                className="bg-success border-background absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full border"
                title="Connected"
              />
            )}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {suffix && <span className="shrink-0">{suffix}</span>}
      </Button>
      {trailing}
    </div>
  );
}

/** Content of a lazily-fetched, non-openable category (Procedures/
 *  Functions/Sequences/Types) — a name plus its optional `extra` context,
 *  no click action. `collapsible_extra` (Types: an enum's
 *  labels, a composite's field list, a domain's base type — often too long
 *  for one line) renders `extra` in its own expand/collapse row instead of
 *  crammed inline next to the name. */
export function LazyObjectRows({
  state,
  empty_label,
  depth,
  collapsible_extra = false,
}: {
  state: "loading" | SchemaObject[] | null | undefined;
  empty_label: string;
  depth: number;
  collapsible_extra?: boolean;
}) {
  const pad = depthPadding(depth);
  const [open_names, setOpenNames] = useState<Set<string>>(new Set());
  // The owning TreeToggleRow's chevron is the loading indicator now —
  // nothing to render here while its fetch is in flight.
  if (state === "loading" || state === undefined) return null;
  if (state === null || state.length === 0) {
    return (
      <p className="text-muted-foreground py-1 text-sm" style={pad}>
        {empty_label}
      </p>
    );
  }
  if (!collapsible_extra) {
    return (
      <>
        {state.map((obj) => (
          <div
            key={obj.name}
            className="text-foreground/80 truncate py-0.5 font-mono text-sm"
            style={pad}
            title={obj.extra ? `${obj.name} — ${obj.extra}` : obj.name}
          >
            {obj.name}
            {obj.extra && (
              <span className="text-muted-foreground ml-1.5 font-sans">
                {obj.extra}
              </span>
            )}
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {state.map((obj) => {
        const is_open = open_names.has(obj.name);
        return (
          <div key={obj.name}>
            <button
              type="button"
              className="text-foreground/80 hover:text-foreground flex w-full min-w-0 items-center gap-1 py-0.5 text-left font-mono text-sm"
              style={pad}
              disabled={!obj.extra}
              title={obj.name}
              onClick={() =>
                setOpenNames((cur) => {
                  const next = new Set(cur);
                  if (next.has(obj.name)) next.delete(obj.name);
                  else next.add(obj.name);
                  return next;
                })
              }
            >
              {obj.extra && (
                <ChevronRight
                  className={cn(
                    "size-2.5 shrink-0 transition-transform",
                    is_open && "rotate-90",
                  )}
                />
              )}
              <span className="truncate">{obj.name}</span>
            </button>
            {is_open && obj.extra && (
              <div
                className="flex flex-col gap-0.5 py-0.5 pr-2"
                style={{ paddingLeft: `${6 + (depth + 1) * 14}px` }}
              >
                {/* One value per line (an enum's labels, a composite's
                    fields) — `extra` is comma-joined by the backend, ", "
                    being the separator it never emits INSIDE a single
                    value. */}
                {obj.extra.split(", ").map((v, i) => (
                  <span
                    key={i}
                    className="text-muted-foreground wrap-break-words text-sm"
                  >
                    {v}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Content of a lazily-fetched Table/View/Materialized View category for a
 *  database/schema OTHER than the connection's active one — same
 *  `TableListItem` row the active one uses, just with whichever handlers
 *  the caller can actually target for it. */
export function LazyTableRows({
  state,
  empty_label,
  depth,
  on_open,
  on_view_structure,
  on_view_grants,
  on_copy,
  on_duplicate,
  on_drop,
  on_refresh_matview,
  is_mongo,
  kind = "table",
  selected_name,
  on_select,
  disabled,
}: {
  state:
    | "loading"
    | (SchemaObject | { name: string; kind?: string })[]
    | null
    | undefined;
  empty_label: string;
  depth: number;
  on_open: (name: string) => void;
  on_view_structure?: (name: string) => void;
  on_view_grants?: (name: string) => void;
  on_copy?: (name: string) => void;
  on_duplicate?: (name: string) => void;
  on_drop?: (name: string) => void;
  on_refresh_matview?: (name: string) => void;
  is_mongo?: boolean;
  kind?: IconType;
  selected_name?: string | null;
  on_select?: (name: string) => void;
  disabled?: boolean;
}) {
  const pad = depthPadding(depth);
  // The owning TreeToggleRow's chevron is the loading indicator now.
  if (state === "loading" || state === undefined) return null;
  if (state === null || state.length === 0) {
    return (
      <p className="text-muted-foreground py-1 text-sm" style={pad}>
        {empty_label}
      </p>
    );
  }
  return (
    <>
      {state.map((obj) => (
        <div key={obj.name} style={pad}>
          <TableListItem
            name={obj.name}
            kind={"kind" in obj && obj.kind ? obj.kind : kind}
            is_mongo={is_mongo}
            is_selected={selected_name === obj.name}
            disabled={disabled}
            on_select={on_select && (() => on_select(obj.name))}
            on_open={() => on_open(obj.name)}
            on_view_structure={
              on_view_structure && (() => on_view_structure(obj.name))
            }
            on_view_grants={on_view_grants && (() => on_view_grants(obj.name))}
            on_copy={on_copy && (() => on_copy(obj.name))}
            on_duplicate={on_duplicate && (() => on_duplicate(obj.name))}
            on_drop={on_drop && (() => on_drop(obj.name))}
            on_refresh_matview={
              on_refresh_matview && (() => on_refresh_matview(obj.name))
            }
          />
        </div>
      ))}
    </>
  );
}
