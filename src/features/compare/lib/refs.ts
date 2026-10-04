import type { ConnectionInfo, TableRef } from "@/shared/api";
import type { DdlDiffSection } from "@/shared/components/diff-grid";
import { stableConnKey } from "@/shared/store";

export type Engine = "sqlite" | "postgres" | "mysql" | "mongodb";

export function engine_of(kind: string): Engine {
  return kind === "documentdb" ? "mongodb" : (kind as Engine);
}

/** The engine a side was picked on, known even while its connection is
 *  closed (the stable key starts with the kind). */
export function ref_engine(ref: TableRef): Engine {
  return engine_of(ref.conn_key.split(":")[0]);
}

/** The open connection behind a side: the same session, else a reopened
 *  session to the same target. */
export function resolve_ref(
  ref: TableRef | null,
  open: ConnectionInfo[],
): ConnectionInfo | null {
  if (!ref) return null;
  return (
    open.find((c) => c.id === ref.conn_id) ??
    open.find((c) => stableConnKey(c) === ref.conn_key) ??
    null
  );
}

export function ref_name(ref: TableRef): string {
  return [ref.database, ref.schema, ref.table].filter(Boolean).join(".");
}

export function diff_counts(sections: DdlDiffSection[]) {
  let add = 0,
    alter = 0,
    drop = 0;
  for (const s of sections)
    for (const r of s.rows) {
      const kind = "kind" in r ? r.kind : "update";
      if (kind === "insert") add++;
      else if (kind === "delete") drop++;
      else alter++;
    }
  return { add, alter, drop };
}
