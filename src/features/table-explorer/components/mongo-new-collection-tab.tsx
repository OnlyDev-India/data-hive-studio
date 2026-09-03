import { useEffect, useRef, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { createMongoCollection, getActiveSchema } from "@/shared/api";
import { useStudioStore } from "@/shared/store";

interface MongoNewCollectionTabProps {
  conn_id: string;
  /** Store key this tab registers its Create action under — the action bar
   *  shows the Create button of whichever new-collection tab is active. */
  tab_key: string;
  active: boolean;
  on_modified: () => void;
}

/** MongoDB's "New table" equivalent: MongoDB is schemaless, so there's no
 *  column/type/FK editor to fill in — just a collection name. Indexes (the
 *  one DDL concept Mongo shares with SQL tables) are added afterward from
 *  the collection's own Schema tab (`MongoIndexesEditor`), once it exists. */
export function MongoNewCollectionTab({
  conn_id,
  tab_key,
  active,
  on_modified,
}: MongoNewCollectionTabProps) {
  const [name, setName] = useState("");
  const [database, setDatabase] = useState("");
  const [creating, setCreating] = useState(false);
  const push_notification = useStudioStore((s) => s.pushNotification);
  const setNewTable = useStudioStore((s) => s.setNewTable);
  const clearNewTable = useStudioStore((s) => s.clearNewTable);

  // Shown for context ("creating in database X") — Mongo connections can
  // span several databases (see the sidebar's database switcher), so it
  // isn't always obvious which one a bare "New table" click targets.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await getActiveSchema(conn_id);
        if (!cancelled) setDatabase(db);
      } catch {
        /* leave blank — creation still targets the connection's active db */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conn_id]);

  const trimmed = name.trim();
  const valid = trimmed !== "";
  const has_draft = trimmed !== "";

  const do_create = async () => {
    if (creating || !valid) return;
    setCreating(true);
    try {
      await createMongoCollection(conn_id, trimmed);
      push_notification({
        kind: "success",
        title: `Collection ${trimmed} created`,
        detail: `db.createCollection("${trimmed}")${database ? ` on ${database}` : ""}`,
      });
      on_modified();
      useStudioStore.getState().openMongo(conn_id, database, trimmed);
    } catch (e) {
      push_notification({
        kind: "error",
        title: `Creating ${trimmed} failed`,
        detail: String(e),
      });
    } finally {
      setCreating(false);
    }
  };

  // Publish the Create action to the action bar — same registration pattern
  // as the SQL NewTableTab, so the existing "Create table" button works
  // unmodified for Mongo too. Refs keep the registered closure fresh.
  const create_ref = useRef(do_create);
  useEffect(() => {
    create_ref.current = do_create;
  });
  const creating_ref = useRef(creating);
  useEffect(() => {
    creating_ref.current = creating;
  }, [creating]);
  const valid_ref = useRef(valid);
  useEffect(() => {
    valid_ref.current = valid;
  });
  const has_draft_ref = useRef(has_draft);
  useEffect(() => {
    has_draft_ref.current = has_draft;
  });
  useEffect(() => {
    if (!active) return;
    setNewTable(tab_key, {
      create: () => void create_ref.current(),
      creating: creating_ref.current,
      valid: valid_ref.current,
      has_draft: has_draft_ref.current,
    });
    return () => clearNewTable(tab_key);
  }, [active, tab_key, creating, valid, has_draft, setNewTable, clearNewTable]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="grid gap-2">
        <label className="text-sm font-medium">Collection name</label>
        <Input
          autoFocus
          placeholder="users"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void do_create();
          }}
        />
        {database && (
          <p className="text-muted-foreground text-xs">
            Creates in database <span className="font-mono">{database}</span>.
          </p>
        )}
      </div>

      <div className="bg-background rounded-md border p-3">
        <div className="text-muted-foreground mb-1 text-xs font-medium">
          Preview
        </div>
        <pre className="bg-muted/50 max-h-40 overflow-auto rounded p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          <code>
            {trimmed ? `db.createCollection("${trimmed}")` : "Enter a collection name."}
          </code>
        </pre>
      </div>

      <p className="text-muted-foreground text-xs">
        MongoDB is schemaless — there's nothing else to define here. Add
        fields by inserting documents once the collection is open, and
        manage indexes from its Schema tab.
      </p>
    </div>
  );
}
