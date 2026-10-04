import { useState } from "react";
import { Loader2, PlugZap, RotateCcw } from "lucide-react";
import {
  getActiveSchema,
  listDatabases,
  listSchemaObjects,
  listSchemasIn,
  listTables,
  type ConnectionInfo,
  type TableRef,
} from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { stableConnKey, useStudioStore } from "@/shared/store";
import { engine_of, ref_name } from "../lib/refs";
import { useAsync } from "../lib/use-async";

const OWN_DB = "\u0000own";

/** Connection → database → schema → table for one side. A side only
 *  counts as picked once its table is chosen; changing anything above the
 *  table clears it. */
export function SidePicker({
  label,
  role,
  value,
  conn,
  candidates,
  on_change,
  on_reopen,
}: {
  label: string;
  role: string;
  value: TableRef | null;
  /** The open connection behind `value`, or null when it isn't open. */
  conn: ConnectionInfo | null;
  candidates: ConnectionInfo[];
  on_change: (ref: TableRef | null) => void;
  on_reopen: () => Promise<string | void>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="text-small flex items-baseline gap-1.5">
        <span className="font-semibold">{label}</span>
        <span className="text-muted-foreground">{role}</span>
      </div>
      {value && !conn ? (
        <ClosedSide value={value} on_change={on_change} on_reopen={on_reopen} />
      ) : (
        <Pickers
          value={value}
          conn={conn}
          candidates={candidates}
          on_change={on_change}
        />
      )}
    </div>
  );
}

function ClosedSide({
  value,
  on_change,
  on_reopen,
}: {
  value: TableRef;
  on_change: (ref: TableRef | null) => void;
  on_reopen: () => Promise<string | void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reopen = async () => {
    setBusy(true);
    setError(null);
    const msg = await on_reopen();
    setBusy(false);
    if (msg) setError(msg);
  };
  return (
    <div className="rounded-control bg-muted/50 flex flex-col gap-2 border border-dashed p-2">
      <div className="text-small flex min-w-0 items-center gap-1.5">
        <PlugZap className="text-muted-foreground size-3.5 shrink-0" />
        <span className="font-medium">Connection not open</span>
        <span className="text-muted-foreground min-w-0 truncate font-mono">
          {value.conn_key.split(":").slice(1).join(":")} · {ref_name(value)}
        </span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={reopen}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RotateCcw className="size-3.5" />
          )}
          Reopen
        </Button>
        <Button size="sm" variant="ghost" onClick={() => on_change(null)}>
          Pick again
        </Button>
      </div>
      {error && <p className="text-destructive text-small">{error}</p>}
    </div>
  );
}

function Pickers({
  value,
  conn: picked_conn,
  candidates,
  on_change,
}: {
  value: TableRef | null;
  conn: ConnectionInfo | null;
  candidates: ConnectionInfo[];
  on_change: (ref: TableRef | null) => void;
}) {
  const recentParams = useStudioStore((s) => s.recentParams);
  const [conn_id, setConnId] = useState(picked_conn?.id ?? "");
  const [database, setDatabase] = useState(value?.database ?? "");
  const [schema, setSchema] = useState(value?.schema ?? "");
  // A side set from outside (a restore) resets the pickers to it; a side
  // cleared by picking above the table keeps what is being picked.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value) {
      setConnId(picked_conn?.id ?? value.conn_id);
      setDatabase(value.database ?? "");
      setSchema(value.schema ?? "");
    }
  }

  const conn =
    candidates.find((c) => c.id === conn_id) ??
    (picked_conn?.id === conn_id ? picked_conn : null);
  const engine = conn ? engine_of(conn.kind) : null;
  const own_db = conn ? recentParams[conn.id]?.database : undefined;

  const dbs = useAsync(
    conn && (engine === "postgres" || engine === "mongodb")
      ? `dbs:${conn.id}`
      : null,
    () => listDatabases(conn_id),
  );
  // Mongo always names its database; Postgres leaves the own one implicit.
  const mongo_db = database || own_db || dbs.data?.[0] || "";

  const schemas = useAsync(
    conn && engine === "postgres" ? `schemas:${conn.id}:${database}` : null,
    () => listSchemasIn(conn_id, database || undefined),
  );
  const active_schema = useAsync(
    conn && engine === "postgres" && !database ? `active:${conn.id}` : null,
    () => getActiveSchema(conn_id),
  );
  const pg_schema =
    schema ||
    (!database ? active_schema.data : null) ||
    (schemas.data?.includes("public") ? "public" : schemas.data?.[0]) ||
    "";

  const tables_key = !conn
    ? null
    : engine === "postgres"
      ? pg_schema
        ? `tables:${conn.id}:${database}:${pg_schema}`
        : null
      : engine === "mongodb"
        ? mongo_db
          ? `tables:${conn.id}:${mongo_db}`
          : null
        : `tables:${conn.id}`;
  const tables = useAsync(tables_key, async () => {
    const id = conn_id;
    if (engine === "postgres")
      return (
        await listSchemaObjects(id, pg_schema, "table", database || undefined)
      ).map((o) => o.name);
    if (engine === "mongodb")
      return (await listSchemaObjects(id, "", "table", mongo_db)).map(
        (o) => o.name,
      );
    return (await listTables(id))
      .filter((t) => t.kind !== "view")
      .map((t) => t.name);
  });

  const clear = () => {
    if (value) on_change(null);
  };

  const pick_table = (table: string) => {
    if (!conn) return;
    on_change({
      conn_id: conn.id,
      conn_key: stableConnKey(conn),
      ...(engine === "postgres"
        ? { ...(database ? { database } : {}), schema: pg_schema }
        : engine === "mongodb"
          ? { database: mongo_db }
          : {}),
      table,
    });
  };

  const db_options =
    engine === "postgres"
      ? [
          { value: OWN_DB, label: own_db ?? "Default database" },
          ...(dbs.data ?? [])
            .filter((d) => d !== own_db)
            .map((d) => ({ value: d, label: d })),
        ]
      : (dbs.data ?? []).map((d) => ({ value: d, label: d }));

  const error = dbs.error ?? schemas.error ?? tables.error;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <Picker
          aria="Connection"
          placeholder="Connection"
          value={conn_id}
          options={candidates.map((c) => ({ value: c.id, label: c.name }))}
          empty="No open connection of this engine"
          on_change={(id) => {
            setConnId(id);
            setDatabase("");
            setSchema("");
            clear();
          }}
        />
        {conn && (engine === "postgres" || engine === "mongodb") && (
          <Picker
            aria="Database"
            placeholder="Database"
            loading={dbs.loading}
            value={engine === "postgres" ? database || OWN_DB : mongo_db}
            options={db_options}
            on_change={(d) => {
              setDatabase(d === OWN_DB ? "" : d);
              setSchema("");
              clear();
            }}
          />
        )}
        {conn && engine === "postgres" && (
          <Picker
            aria="Schema"
            placeholder="Schema"
            loading={schemas.loading}
            value={pg_schema}
            options={(schemas.data ?? []).map((s) => ({ value: s, label: s }))}
            on_change={(s) => {
              setSchema(s);
              clear();
            }}
          />
        )}
        {conn && (
          <Picker
            aria={engine === "mongodb" ? "Collection" : "Table"}
            placeholder={engine === "mongodb" ? "Collection" : "Table"}
            loading={tables.loading}
            value={value?.table ?? ""}
            options={(tables.data ?? []).map((t) => ({ value: t, label: t }))}
            empty={engine === "mongodb" ? "No collections" : "No tables"}
            on_change={pick_table}
            wide
          />
        )}
      </div>
      {error && <p className="text-destructive text-small">{error}</p>}
    </div>
  );
}

function Picker({
  aria,
  placeholder,
  value,
  options,
  on_change,
  loading,
  empty,
  wide,
}: {
  aria: string;
  placeholder: string;
  value: string;
  options: { value: string; label: string }[];
  on_change: (value: string) => void;
  loading?: boolean;
  empty?: string;
  wide?: boolean;
}) {
  const label = options.find((o) => o.value === value)?.label ?? value;
  return (
    <Select
      value={value || null}
      onValueChange={(v) => v !== null && on_change(v as string)}
    >
      <SelectTrigger
        size="sm"
        aria-label={aria}
        className={wide ? "max-w-64 min-w-40" : "max-w-48 min-w-28"}
      >
        <SelectValue>
          {() =>
            loading ? (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                {placeholder}
              </span>
            ) : label ? (
              <span className="truncate font-mono">{label}</span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.length === 0 ? (
            <div className="text-muted-foreground text-small px-2 py-1.5">
              {loading ? "Loading…" : (empty ?? "Nothing to pick")}
            </div>
          ) : (
            options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                <span className="font-mono">{o.label}</span>
              </SelectItem>
            ))
          )}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
