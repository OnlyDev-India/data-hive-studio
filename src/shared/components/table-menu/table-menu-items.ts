import {
  Copy,
  CopyPlus,
  Eye,
  GitCompareArrows,
  RefreshCw,
  ShieldCheck,
  Table as TableIcon,
  Trash2,
  Upload,
  Workflow,
  Blocks,
  type LucideIcon,
} from "lucide-react";

export type TableAction =
  | "open"
  | "structure"
  | "compare"
  | "aggregate"
  | "query_builder"
  | "grants"
  | "copy"
  | "duplicate"
  | "import"
  | "refresh_matview"
  | "drop";

/** One menu row; `A` is the surface's own action union. */
export interface MenuEntry<A extends string = string> {
  action: A;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  title?: string;
  destructive?: boolean;
  separatorBefore?: boolean;
}

export type TableMenuItem = MenuEntry<TableAction>;

export const READ_ONLY_TITLE = "Read only connection: this change is refused";

/** Every action a table menu can show. */
export const ALL_TABLE_ACTIONS: ReadonlySet<TableAction> = new Set([
  "open",
  "structure",
  "compare",
  "aggregate",
  "query_builder",
  "grants",
  "copy",
  "duplicate",
  "import",
  "refresh_matview",
  "drop",
]);

/** What the diagram offers: everything but refreshing a materialized view. */
export const DIAGRAM_TABLE_ACTIONS: ReadonlySet<TableAction> = new Set(
  [...ALL_TABLE_ACTIONS].filter((a) => a !== "refresh_matview"),
);

const isMatview = (kind: string) =>
  kind === "matview" || kind === "materialized_view";

/** The one table menu, shared by the sidebar and the diagram. `offer` is
 *  the set of actions the caller can carry out for this row. */
export function tableMenuItems({
  mongo,
  pg,
  objectKind,
  readOnly,
  busy = false,
  offer,
}: {
  mongo: boolean;
  pg: boolean;
  objectKind: string;
  readOnly: boolean;
  busy?: boolean;
  offer: ReadonlySet<TableAction>;
}): TableMenuItem[] {
  const noun = mongo ? "collection" : "table";
  const tableLike = mongo || objectKind === "table";
  const ro = readOnly ? READ_ONLY_TITLE : undefined;
  const items: TableMenuItem[] = [
    { action: "open", label: `Open ${noun}`, icon: TableIcon, disabled: false },
  ];
  const add = (item: TableMenuItem, show = true) => {
    if (show && offer.has(item.action)) items.push(item);
  };
  add({
    action: "structure",
    label: "View structure",
    icon: Eye,
    disabled: false,
  });
  add(
    {
      action: "compare",
      label: "Compare with…",
      icon: GitCompareArrows,
      disabled: false,
    },
    tableLike,
  );
  add(
    {
      action: "aggregate",
      label: "New aggregation",
      icon: Workflow,
      disabled: false,
    },
    mongo,
  );
  add(
    {
      action: "query_builder",
      label: "New query builder",
      icon: Blocks,
      disabled: false,
    },
    !mongo,
  );
  add(
    {
      action: "grants",
      label: "View grants",
      icon: ShieldCheck,
      disabled: false,
    },
    pg && !mongo,
  );
  add({
    action: "copy",
    label: `Copy ${noun} name`,
    icon: Copy,
    disabled: false,
  });
  add({
    action: "duplicate",
    label: `Duplicate ${noun}`,
    icon: CopyPlus,
    disabled: busy || readOnly,
    title: ro,
  });
  add(
    {
      action: "import",
      label: `Import into ${noun}…`,
      icon: Upload,
      disabled: busy || readOnly,
      title: ro,
    },
    tableLike,
  );
  add(
    {
      action: "refresh_matview",
      label: "Refresh materialized view",
      icon: RefreshCw,
      disabled: readOnly,
      title: ro,
    },
    isMatview(objectKind),
  );
  add({
    action: "drop",
    label: `Drop ${noun}…`,
    icon: Trash2,
    disabled: readOnly,
    title: ro,
    destructive: true,
    separatorBefore: true,
  });
  return items;
}
