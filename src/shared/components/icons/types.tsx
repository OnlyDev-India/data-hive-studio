import type { DbKind, SchemaObjectKind } from "@/shared/api";
import DocumentDbIcon from "./documentDb";
import MongoIcon from "./mongo";
import MySqlIcon from "./mysql";
import PGIcon from "./pg";
import SqliteIcon from "./sqlite";
import {
  Play,
  Eye,
  Layers,
  TableIcon,
  ListOrdered,
  FunctionSquare,
  Shapes,
  DatabaseIcon,
  FolderIcon,
  UsersIcon,
  Code,
  SquarePlus,
  Terminal,
  History,
  Puzzle,
  GitCompareArrows,
  Network,
} from "lucide-react";
import type { StudioTab } from "@/shared/store";
import { cn } from "@/shared/lib/utils";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  className?: string;
  active?: boolean;
  disabled?: boolean;
}

/** "documentdb" isn't a real `DbKind` — Amazon DocumentDB is stored and
 *  connected to as a plain `mongodb` connection (see `landing.tsx`'s
 *  `DbKindChoice`). It only exists here so the database-type picker has an
 *  icon to show for that entry, via the same `DBIcons` lookup table every
 *  other kind uses. */
export type DbIconKind = DbKind | "documentdb";

export const DBIcons: Record<DbIconKind, React.ComponentType<IconProps>> = {
  mongodb: MongoIcon,
  mysql: MySqlIcon,
  postgres: PGIcon,
  sqlite: SqliteIcon,
  documentdb: DocumentDbIcon,
};

export type IconType =
  | SchemaObjectKind
  | StudioTab["kind"]
  | "database"
  | "folder"
  | "users"
  | "layers"
  | "extension";

export const TAB_ICON_CLASS: Record<
  "table" | "sql" | "new-table" | "mongo-console" | "compare" | "relation-diagram",
  string
> = {
  table: "text-obj-relation",
  "new-table": "text-obj-relation",
  sql: "text-primary",
  "mongo-console": "text-primary",
  compare: "text-primary",
  "relation-diagram": "text-obj-relation",
};

export const IconTypeMap: Record<IconType, React.ReactNode> = {
  table: <TableIcon className="text-obj-relation size-3 shrink-0" />,
  view: <Eye className="text-obj-relation size-3 shrink-0" />,
  materialized_view: <Layers className="text-obj-relation size-3 shrink-0" />,
  procedure: <Play className="text-obj-routine size-3 shrink-0" />,
  function: <FunctionSquare className="text-obj-routine size-3 shrink-0" />,
  sequence: <ListOrdered className="text-obj-type size-3 shrink-0" />,
  type: <Shapes className="text-obj-type size-3 shrink-0" />,
  database: <DatabaseIcon className="text-obj-container size-3 shrink-0" />,
  folder: <FolderIcon className="text-obj-container size-3 shrink-0" />,
  users: <UsersIcon className="text-obj-security size-3 shrink-0" />,
  layers: <Layers className="text-obj-container size-3 shrink-0" />,
  extension: <Puzzle className="text-obj-extension size-3 shrink-0" />,
  mongo: <MongoIcon className={cn("size-3.5")} />,
  sql: <Code className={cn("size-3.5", TAB_ICON_CLASS.sql)} />,
  "new-table": (
    <SquarePlus className={cn("size-3.5", TAB_ICON_CLASS["new-table"])} />
  ),
  "mongo-console": (
    <Terminal className={cn("size-3.5", TAB_ICON_CLASS["mongo-console"])} />
  ),
  activity: <History className={cn("text-muted-foreground size-3.5")} />,
  roles: <UsersIcon className="text-obj-security size-3 shrink-0" />,
  "relation-diagram": (
    <Network className={cn("size-3.5", TAB_ICON_CLASS["relation-diagram"])} />
  ),
  compare: (
    <GitCompareArrows className={cn("size-3.5", TAB_ICON_CLASS.compare)} />
  ),
};
