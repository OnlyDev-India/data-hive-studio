import type { DbKind } from "@/shared/api";
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

export const DBIcons: Record<DbKind, React.ComponentType<IconProps>> = {
  mongodb: MongoIcon,
  mysql: MySqlIcon,
  postgres: PGIcon,
  sqlite: SqliteIcon,
};
