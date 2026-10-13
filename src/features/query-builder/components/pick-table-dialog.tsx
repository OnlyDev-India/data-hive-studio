import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  getActiveSchema,
  listDatabases,
  listSchemaObjects,
  listSchemasIn,
  listTables,
} from "@/shared/api";
import { openQueryBuilderFor, useStudioStore } from "@/shared/store";
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

const useAsk = create<{ conn_id: string | null }>(() => ({ conn_id: null }));

/** Ask for the table a new query builder starts from (database and schema
 *  too on Postgres), then open it. Needs `PickTableHost` mounted once. */
export function openQueryBuilderPicked(conn_id: string) {
  useAsk.setState({ conn_id });
}

export function PickTableHost() {
  const conn_id = useAsk((s) => s.conn_id);
  if (!conn_id) return null;
  return <PickTableDialog key={conn_id} conn_id={conn_id} />;
}

function Field({
  id,
  label,
  value,
  options,
  onValue,
  empty,
}: {
  id: string;
  label: string;
  value: string;
  options: string[] | null;
  onValue: (v: string) => void;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(v) => v && onValue(String(v))}
        disabled={!options?.length}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={options === null ? "Loading…" : empty} />
        </SelectTrigger>
        <SelectContent>
          {(options ?? []).map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PickTableDialog({ conn_id }: { conn_id: string }) {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const own = useStudioStore(
    (s) => s.recentParams[conn_id]?.database ?? conn?.name ?? "",
  );
  const pg = conn?.kind === "postgres";
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [database, setDatabase] = useState(own);
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [schema, setSchema] = useState("");
  const [tables, setTables] = useState<string[] | null>(null);
  const [table, setTable] = useState("");
  const [error, setError] = useState<string | null>(null);
  const db = database === own ? undefined : database;

  const close = () => useAsk.setState({ conn_id: null });
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    if (!pg) return;
    let live = true;
    void listDatabases(conn_id)
      .then((all) => live && setDatabases(all))
      .catch((e: unknown) => live && fail(e));
    return () => {
      live = false;
    };
  }, [conn_id, pg]);

  useEffect(() => {
    if (!pg) return;
    let live = true;
    void Promise.all([
      listSchemasIn(conn_id, db),
      getActiveSchema(conn_id).catch(() => "public"),
    ])
      .then(([all, active]) => {
        if (!live) return;
        setSchemas(all);
        setSchema(all.includes(active) ? active : (all[0] ?? ""));
      })
      .catch((e: unknown) => live && fail(e));
    return () => {
      live = false;
    };
  }, [conn_id, pg, db]);

  useEffect(() => {
    if (pg && !schema) return;
    let live = true;
    const load = pg
      ? Promise.all([
          listSchemaObjects(conn_id, schema, "table", db),
          listSchemaObjects(conn_id, schema, "view", db).catch(() => []),
        ]).then(([t, v]) => [...t, ...v].map((o) => o.name))
      : listTables(conn_id).then((t) => t.map((o) => o.name));
    void load
      .then((names) => {
        if (!live) return;
        const sorted = [...names].sort();
        setTables(sorted);
        setTable(sorted[0] ?? "");
      })
      .catch((e: unknown) => live && fail(e));
    return () => {
      live = false;
    };
  }, [conn_id, pg, db, schema]);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New query builder</DialogTitle>
          <DialogDescription>
            Pick the table the query starts from.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!conn || !table) return;
            openQueryBuilderFor(conn, {
              database: db,
              schema: pg ? schema : undefined,
              table,
            });
            close();
          }}
        >
          {pg && (
            <>
              <Field
                id="qb-database"
                label="Database"
                value={database}
                options={databases}
                empty="No databases"
                onValue={(d) => {
                  setDatabase(d);
                  setSchemas(null);
                  setTables(null);
                  setTable("");
                }}
              />
              <Field
                id="qb-schema"
                label="Schema"
                value={schema}
                options={schemas}
                empty="This database has no schemas"
                onValue={(s) => {
                  setSchema(s);
                  setTables(null);
                  setTable("");
                }}
              />
            </>
          )}
          <Field
            id="qb-table"
            label="Table"
            value={table}
            options={tables}
            empty="No tables here"
            onValue={setTable}
          />
          {error && (
            <p role="alert" className="text-destructive text-small">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!table}>
              Open
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
