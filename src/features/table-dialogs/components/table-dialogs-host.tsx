import { useEffect, useState } from "react";
import {
  duplicateTable,
  executeOp,
  quoteIdent,
  runSql,
  type ConnectionInfo,
} from "@/shared/api";
import {
  useRelationGraphs,
  useStudioStore,
  type TableDialogTarget,
} from "@/shared/store";
import { timestampedCopyName, uniqueCopyName } from "../lib/copy-names";
import {
  DropDialog,
  DuplicateDialog,
  DuplicateMongoDialog,
  GrantsDialog,
} from "./dialogs";

const escLit = (v: string) => v.replace(/'/g, "''");

/** Records a successful Drop or Duplicate, so the sidebar reloads the node
 *  that held the table and every open diagram of it reloads. */
function noteChange(conn: ConnectionInfo, t: TableDialogTarget) {
  const mongo = conn.kind === "mongodb";
  useStudioStore.getState().noteCatalogChange(conn.id, {
    database: mongo ? (t.database ?? conn.name) : t.database,
    schema: t.schema,
    objectKind: t.objectKind,
  });
  useRelationGraphs
    .getState()
    .reloadMatching(
      conn.id,
      conn.kind === "sqlite" ? undefined : (t.database ?? conn.name),
      conn.kind === "postgres" ? t.schema : undefined,
      conn.name,
    );
}

/** The Drop, Duplicate and Grants dialogs, mounted once for the sidebar
 *  and the diagram alike. */
export function TableDialogsHost() {
  const target = useStudioStore((s) => s.tableDialog);
  const busy = useStudioStore((s) => s.tableDialogBusy);
  const setBusy = useStudioStore((s) => s.setTableDialogBusy);
  const close = useStudioStore((s) => s.closeTableDialog);
  const conns = useStudioStore((s) => s.open);

  // The last target stays drawn while the dialog animates closed.
  const [last, setLast] = useState(target);
  const [name, setName] = useState("");
  const [copyData, setCopyData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<(string | null)[][] | null>(null);
  const conn = last ? conns.find((c) => c.id === last.connId) : undefined;
  const mongo = conn?.kind === "mongodb";
  if (target && target !== last) {
    const isMongo =
      conns.find((c) => c.id === target.connId)?.kind === "mongodb";
    const taken = (target.taken ?? []).map((n) => ({ name: n }));
    setLast(target);
    setError(null);
    setCopyData(true);
    setRows(null);
    setName(
      target.kind !== "duplicate"
        ? ""
        : isMongo
          ? timestampedCopyName(target.table, taken)
          : uniqueCopyName(target.table, taken),
    );
  }

  const grantsFor = target?.kind === "grants" ? target : null;
  useEffect(() => {
    if (!grantsFor) return;
    let cancelled = false;
    runSql(
      grantsFor.connId,
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='${escLit(grantsFor.schema ?? "public")}' AND table_name='${escLit(grantsFor.table)}' ORDER BY 1, 2`,
      "app",
      grantsFor.database,
    ).then(
      (res) => !cancelled && setRows(res.rows),
      () => !cancelled && setRows([]),
    );
    return () => {
      cancelled = true;
    };
  }, [grantsFor]);

  const run = async (work: (t: TableDialogTarget) => Promise<void>) => {
    if (!last || !conn || busy) return;
    const t = last;
    setBusy(true);
    setError(null);
    let ok = false;
    try {
      await work(t);
      ok = true;
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
    if (!ok) return;
    close();
    noteChange(conn, t);
  };

  const drop = () =>
    run(async (t) => {
      if (t.objectKind === "table") {
        await executeOp(
          t.connId,
          { kind: "drop_table", table: t.table },
          t.database,
          t.schema,
        );
        return;
      }
      // `runSql` takes no schema, so it goes into the SQL text.
      const qualified = t.schema
        ? `${quoteIdent(t.schema)}.${quoteIdent(t.table)}`
        : quoteIdent(t.table);
      await runSql(
        t.connId,
        `DROP VIEW IF EXISTS ${qualified}`,
        "user",
        t.database,
      );
    });

  const duplicate = () => {
    const next = name.trim();
    const noun = mongo ? "collection" : "table";
    if (!next) {
      setError(`Enter a name for the duplicate ${noun}.`);
      return;
    }
    const lower = next.toLowerCase();
    if (last?.taken?.some((n) => n.toLowerCase() === lower)) {
      setError(`A ${noun} named “${next}” already exists.`);
      return;
    }
    void run(async (t) => {
      const s = useStudioStore.getState();
      if (mongo) {
        await duplicateTable(t.connId, t.table, next, copyData, t.database);
        s.openMongo(t.connId, t.database ?? conn?.name ?? "", next);
      } else {
        await duplicateTable(
          t.connId,
          t.table,
          next,
          true,
          t.database,
          t.schema,
        );
        s.openTable(t.connId, next, undefined, t.database, t.schema);
      }
    });
  };

  const onOpenChange = (open: boolean) => {
    if (!open) close();
  };
  const shown = target ?? null;
  return (
    <>
      <DropDialog
        open={shown?.kind === "drop"}
        on_open_change={onOpenChange}
        noun={mongo ? "collection" : "table"}
        name={last?.table ?? ""}
        error={error}
        busy={busy}
        on_confirm={() => void drop()}
      />
      <DuplicateDialog
        open={shown?.kind === "duplicate" && !mongo}
        on_open_change={onOpenChange}
        name={last?.table ?? ""}
        value={name}
        on_value_change={setName}
        error={error}
        submitting={busy}
        on_confirm={duplicate}
      />
      <DuplicateMongoDialog
        open={shown?.kind === "duplicate" && mongo}
        on_open_change={onOpenChange}
        name={last?.table ?? ""}
        value={name}
        on_value_change={setName}
        copy_data={copyData}
        on_copy_data_change={setCopyData}
        error={error}
        submitting={busy}
        on_confirm={duplicate}
      />
      <GrantsDialog
        open={shown?.kind === "grants"}
        on_open_change={onOpenChange}
        name={last?.table ?? null}
        rows={rows}
      />
    </>
  );
}
