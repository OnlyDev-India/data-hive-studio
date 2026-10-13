import { useEffect, useState } from "react";
import { ClipboardPaste, SquareTerminal } from "lucide-react";
import { listDatabases, listSchemasIn } from "@/shared/api";
import { Pick } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";

/** The bar above the canvas: the database and schema (Postgres), Paste SQL
 *  and Open in SQL editor. */
export function QueryHeader({
  conn_id,
  connected,
  postgres,
  ownDatabase,
  database,
  schema,
  onDatabase,
  onSchema,
  onPaste,
  onOpenSql,
  canOpenSql,
  openSqlTitle,
}: {
  conn_id: string;
  connected: boolean;
  postgres: boolean;
  /** The connection's own database, what a null `database` means. */
  ownDatabase: string;
  database: string | null;
  schema: string | null;
  onDatabase: (database: string) => void;
  onSchema: (schema: string) => void;
  onPaste: () => void;
  onOpenSql: () => void;
  canOpenSql: boolean;
  openSqlTitle: string;
}) {
  const db = database ?? ownDatabase;
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<{ db: string; list: string[] }>({
    db: "",
    list: [],
  });

  useEffect(() => {
    if (!postgres || !connected) return;
    let live = true;
    void listDatabases(conn_id)
      .then((list) => {
        if (live) setDatabases(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [conn_id, postgres, connected]);

  useEffect(() => {
    if (!postgres || !connected) return;
    let live = true;
    void listSchemasIn(conn_id, database ?? undefined)
      .then((list) => {
        if (live) setSchemas({ db, list });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [conn_id, postgres, connected, database, db]);

  const withCurrent = (list: string[], cur: string) =>
    list.includes(cur) ? list : [cur, ...list];

  return (
    <div
      role="toolbar"
      aria-label="Query target"
      className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1"
    >
      {postgres && (
        <>
          <div className="w-44">
            <Pick
              label="Database"
              value={db}
              options={withCurrent(databases, db).map((d) => [d, d])}
              onValue={onDatabase}
              mono
            />
          </div>
          <div className="w-40">
            <Pick
              label="Schema"
              value={schema ?? ""}
              options={withCurrent(
                schemas.db === db ? schemas.list : [],
                schema ?? "",
              ).map((s) => [s, s])}
              onValue={onSchema}
              mono
            />
          </div>
        </>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onPaste}
        title="Replace the cards with a pasted SELECT"
      >
        <ClipboardPaste className="size-3.5" />
        Paste SQL
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenSql}
        disabled={!canOpenSql}
        title={openSqlTitle}
      >
        <SquareTerminal className="size-3.5" />
        Open in SQL editor
      </Button>
    </div>
  );
}
