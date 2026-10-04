import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { listDatabases, listSchemaObjects } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";

type Listing = string[] | { error: string } | null;

/** The database and collection the pipeline runs on, one dropdown each.
 *  Picking another database opens its collections; the tab switches only
 *  once a collection is picked. Lists load when they open. */
export function CollectionPicker({
  conn_id,
  database,
  collection,
  onPick,
}: {
  conn_id: string;
  database: string;
  collection: string;
  onPick: (database: string, collection: string) => void;
}) {
  const [databases, setDatabases] = useState<Listing>(null);
  const [collections, setCollections] = useState<Listing>(null);
  /** A database picked but not yet given a collection. */
  const [pending, setPending] = useState<string | null>(null);
  const [collections_open, setCollectionsOpen] = useState(false);
  const shown_db = pending ?? database;

  const fail = (e: unknown) => ({
    error: e instanceof Error ? e.message : String(e),
  });

  const loadCollections = (db: string) => {
    setCollections(null);
    listSchemaObjects(conn_id, "", "table", db).then(
      (objs) => setCollections(objs.map((o) => o.name).sort()),
      (e) => setCollections(fail(e)),
    );
  };

  const openCollections = (open: boolean, db = shown_db) => {
    setCollectionsOpen(open);
    if (open) loadCollections(db);
    else setPending(null);
  };

  const items = (
    listing: Listing,
    empty: string,
    current: string | null,
    onClick: (name: string) => void,
  ): ReactNode => {
    if (!listing)
      return (
        <p className="text-muted-foreground text-small flex items-center gap-1.5 px-2 py-1.5">
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
          Loading…
        </p>
      );
    if (!Array.isArray(listing))
      return (
        <p className="text-destructive text-small px-2 py-1.5">
          {listing.error}
        </p>
      );
    if (listing.length === 0)
      return (
        <p className="text-muted-foreground text-small px-2 py-1.5">{empty}</p>
      );
    return listing.map((name) => (
      <DropdownMenuItem
        key={name}
        className="font-mono"
        onClick={() => onClick(name)}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {name === current && <Check className="size-3.5" />}
      </DropdownMenuItem>
    ));
  };

  const trigger = (label: string, value: string, muted = false) => (
    <Button
      variant="ghost"
      size="sm"
      className="max-w-56 min-w-0 font-mono"
      title={value}
      aria-label={label}
    >
      <span className={muted ? "text-muted-foreground truncate" : "truncate"}>
        {value}
      </span>
      <ChevronDown className="size-3 shrink-0" />
    </Button>
  );

  return (
    <div className="flex min-w-0 items-center">
      <DropdownMenu
        onOpenChange={(open) => {
          if (!open) return;
          setDatabases(null);
          listDatabases(conn_id).then(
            (d) => setDatabases(d.includes(database) ? d : [database, ...d]),
            (e) => setDatabases(fail(e)),
          );
        }}
      >
        <DropdownMenuTrigger render={trigger("Database", shown_db, true)} />
        <DropdownMenuContent align="start" className="max-h-80 w-56">
          {items(databases, "No databases", shown_db, (db) => {
            setPending(db === database ? null : db);
            // Let this menu close before the next one opens.
            requestAnimationFrame(() => openCollections(true, db));
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-muted-foreground text-small">/</span>
      <DropdownMenu
        open={collections_open}
        onOpenChange={(open) => openCollections(open)}
      >
        <DropdownMenuTrigger
          render={trigger(
            "Collection",
            pending ? "Pick a collection" : collection,
            !!pending,
          )}
        />
        <DropdownMenuContent align="start" className="max-h-80 w-64">
          {items(
            collections,
            "No collections",
            pending ? null : collection,
            (name) => {
              if (shown_db !== database || name !== collection)
                onPick(shown_db, name);
            },
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
