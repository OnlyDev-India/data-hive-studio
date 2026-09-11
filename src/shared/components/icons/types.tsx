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
  | "layers";

export const IconTypeMap: Record<IconType, React.ReactNode> = {
  table: <TableIcon className="size-3 shrink-0 text-sky-500" />,
  view: <Eye className="size-3 shrink-0 text-purple-500" />,
  materialized_view: <Layers className="size-3 shrink-0 text-indigo-500" />,
  procedure: <Play className="size-3 shrink-0 text-green-500" />,
  function: <FunctionSquare className="size-3 shrink-0 text-orange-500" />,
  sequence: <ListOrdered className="size-3 shrink-0 text-pink-500" />,
  type: <Shapes className="size-3 shrink-0 text-teal-500" />,
  database: <DatabaseIcon className="size-3 shrink-0 text-blue-500" />,
  folder: <FolderIcon className="size-3 shrink-0 text-amber-500" />,
  users: <UsersIcon className="size-3 shrink-0 text-rose-500" />,
  layers: <Layers className="size-3 shrink-0 text-indigo-500" />,
  mongo: <MongoIcon className={cn("size-3.5")} />,
  sql: <Code className={cn("size-3.5 text-emerald-400")} />,
  "new-table": <SquarePlus className={cn("size-3.5 text-orange-400")} />,
  "mongo-console": <Terminal className={cn("size-3.5 text-sky-400")} />,
  activity: <History className={cn("text-muted-foreground size-3.5")} />,
  roles: <UsersIcon className="size-3 shrink-0 text-rose-500" />,
};
