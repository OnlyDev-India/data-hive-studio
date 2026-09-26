import type { SavedDbKind } from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { DBIcons, type IconProps } from "@/shared/components/icons/types";

export interface KindItem {
  id: SavedDbKind;
  label: string;
  icon: React.ComponentType<IconProps>;
}

const DB_KIND_ITEMS: KindItem[] = [
  { id: "sqlite", label: "SQLite", icon: DBIcons.sqlite },
  { id: "postgres", label: "PostgreSQL", icon: DBIcons.postgres },
  { id: "mongodb", label: "MongoDB", icon: DBIcons.mongodb },
  { id: "documentdb", label: "Amazon DocumentDB", icon: DBIcons.documentdb },
];

/** The web build has no local files, so no SQLite. */
export const KIND_ITEMS = WEB
  ? DB_KIND_ITEMS.filter((i) => i.id !== "sqlite")
  : DB_KIND_ITEMS;

export function kindItem(kind: SavedDbKind): KindItem {
  return DB_KIND_ITEMS.find((i) => i.id === kind) ?? DB_KIND_ITEMS[1];
}
