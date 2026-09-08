import type { DbKind } from "@/shared/api";
import DocumentDbIcon from "./documentDb";
import MongoIcon from "./mongo";
import MySqlIcon from "./mysql";
import PGIcon from "./pg";
import SqliteIcon from "./sqlite";

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
