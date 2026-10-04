import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  getActiveSchema,
  listDatabases,
  listSchemaObjects,
} from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

export interface PickedCollection {
  database: string;
  collection: string;
}

interface Ask {
  conn_id: string;
  title: string;
  description: string;
  /** The database to start on; the connection's active one when absent. */
  database?: string;
  resolve: (picked: PickedCollection | null) => void;
}

const usePicker = create<{ ask: Ask | null }>(() => ({ ask: null }));

/** Ask for a database and one of its collections on a Mongo connection.
 *  Resolves null when the dialog is cancelled. Needs `CollectionPickerHost`
 *  mounted once. */
export function pickCollection(
  conn_id: string,
  opts: { title: string; description: string; database?: string },
): Promise<PickedCollection | null> {
  usePicker.getState().ask?.resolve(null);
  return new Promise((resolve) =>
    usePicker.setState({ ask: { conn_id, ...opts, resolve } }),
  );
}

export function CollectionPickerHost() {
  const ask = usePicker((s) => s.ask);
  if (!ask) return null;
  // A fresh form per question.
  return (
    <PickerDialog
      key={`${ask.conn_id}:${ask.title}:${ask.database ?? ""}`}
      ask={ask}
    />
  );
}

function PickerDialog({ ask }: { ask: Ask }) {
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [database, setDatabase] = useState(ask.database ?? "");
  const [collections, setCollections] = useState<string[] | null>(null);
  const [collection, setCollection] = useState("");
  const [error, setError] = useState<string | null>(null);

  const finish = (picked: PickedCollection | null) => {
    usePicker.setState({ ask: null });
    ask.resolve(picked);
  };

  useEffect(() => {
    let live = true;
    void Promise.all([
      listDatabases(ask.conn_id),
      ask.database
        ? Promise.resolve(ask.database)
        : getActiveSchema(ask.conn_id).catch(() => ""),
    ])
      .then(([all, active]) => {
        if (!live) return;
        setDatabases(all);
        setDatabase(
          (cur) => cur || (all.includes(active) ? active : all[0]) || "",
        );
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [ask.conn_id, ask.database]);

  useEffect(() => {
    if (!database) return;
    let live = true;
    listSchemaObjects(ask.conn_id, "", "table", database)
      .then((objs) => {
        if (!live) return;
        const names = objs.map((o) => o.name).sort();
        setCollections(names);
        setCollection(names[0] ?? "");
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [ask.conn_id, database]);

  return (
    <Dialog open onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{ask.title}</DialogTitle>
          <DialogDescription>{ask.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (database && collection) finish({ database, collection });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pick-database">Database</Label>
            <Select
              value={database}
              onValueChange={(v) => {
                if (!v) return;
                setDatabase(String(v));
                setCollections(null);
                setCollection("");
              }}
              disabled={!databases}
            >
              <SelectTrigger id="pick-database" className="w-full">
                <SelectValue placeholder="Loading…" />
              </SelectTrigger>
              <SelectContent>
                {(databases ?? []).map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pick-collection">Collection</Label>
            <Select
              value={collection}
              onValueChange={(v) => v && setCollection(String(v))}
              disabled={!collections?.length}
            >
              <SelectTrigger id="pick-collection" className="w-full">
                <SelectValue
                  placeholder={
                    collections === null
                      ? "Loading…"
                      : "This database has no collections"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {(collections ?? []).map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-small">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => finish(null)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!database || !collection}>
              Open
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
