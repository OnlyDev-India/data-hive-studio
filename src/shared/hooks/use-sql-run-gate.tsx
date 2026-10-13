import { useCallback, useState, type ReactNode } from "react";
import { BindVariablesDialog } from "@/shared/components/bind-variables-dialog";
import type { ConfirmItem } from "@/shared/components/write-confirm-dialog";
import {
  findBindVariables,
  substituteBindVariables,
} from "@/shared/lib/bind-variables";
import { dangerousSqlReason } from "@/shared/lib/dangerous-sql";
import { isWriteSql } from "@/shared/lib/write-detect";
import { useStudioStore } from "@/shared/store";
import { useWriteConfirm, type WriteConfirmRequest } from "./use-write-confirm";

/** The gate every SQL run passes, in the editor and the query builder:
 *  first a value per `:name` or `${name}` bind variable, substituted into
 *  the texts, then one confirm for every statement that needs it (an
 *  UPDATE or DELETE with no WHERE, TRUNCATE, DROP, and any write on a
 *  connection that confirms writes). A read only connection never asks:
 *  the backend refuses the write, and that refusal is the answer.
 *
 *  - `binds(texts)`: the texts with values in, null when cancelled.
 *  - `confirm(texts)`: true when nothing needs asking, or on confirm.
 *  - `gate(texts)`: both in turn, null when either is cancelled.
 *  - `dialogs`: render once, anywhere in the component. */
export function useSqlRunGate(conn_id: string): {
  binds: (texts: string[]) => Promise<string[] | null>;
  confirm: (texts: string[]) => Promise<boolean>;
  gate: (texts: string[]) => Promise<string[] | null>;
  ask: (request: WriteConfirmRequest) => Promise<boolean>;
  env_reason: string | null;
  read_only: boolean;
  dialogs: ReactNode;
} {
  const { ask, env_reason, dialog } = useWriteConfirm(conn_id);
  const read_only = useStudioStore(
    (s) => !!s.open.find((c) => c.id === conn_id)?.read_only,
  );

  const confirm = useCallback(
    (texts: string[]): Promise<boolean> => {
      if (read_only) return Promise.resolve(true);
      // Both reasons for one statement share one row, never two.
      const items: ConfirmItem[] = [];
      for (const text of texts) {
        const reasons: string[] = [];
        const danger = dangerousSqlReason(text);
        if (danger) reasons.push(danger);
        if (env_reason && isWriteSql(text)) reasons.push(env_reason);
        if (reasons.length > 0) items.push({ text, reasons });
      }
      if (items.length === 0) return Promise.resolve(true);
      return ask({
        items,
        description:
          items.length === 1
            ? "This statement needs confirmation before it runs:"
            : `${items.length} statements in this run need confirmation before they run:`,
      });
    },
    [read_only, env_reason, ask],
  );

  // Values go in before the confirm sees the texts, so a DELETE whose
  // `:id` is left empty (NULL) is still checked as written.
  const [pending, setPending] = useState<{
    names: string[];
    resolve: (values: Record<string, string> | null) => void;
  } | null>(null);
  const binds = useCallback((texts: string[]): Promise<string[] | null> => {
    const names = findBindVariables(texts);
    if (names.length === 0) return Promise.resolve(texts);
    return new Promise((resolve) => {
      setPending({
        names,
        resolve: (values) =>
          resolve(
            values
              ? texts.map((t) => substituteBindVariables(t, values))
              : null,
          ),
      });
    });
  }, []);

  const gate = useCallback(
    async (texts: string[]) => {
      const bound = await binds(texts);
      if (!bound) return null;
      return (await confirm(bound)) ? bound : null;
    },
    [binds, confirm],
  );

  const settle = (values: Record<string, string> | null) => {
    pending?.resolve(values);
    setPending(null);
  };
  const dialogs = (
    <>
      <BindVariablesDialog
        names={pending?.names ?? null}
        onConfirm={settle}
        onCancel={() => settle(null)}
      />
      {dialog}
    </>
  );

  return { binds, confirm, gate, ask, env_reason, read_only, dialogs };
}
