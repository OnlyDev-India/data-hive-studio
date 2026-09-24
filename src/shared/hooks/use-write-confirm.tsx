import { useCallback, useState, type ReactNode } from "react";
import { envConfirmReason, needsWriteConfirm } from "@/shared/api";
import {
  WriteConfirmDialog,
  type ConfirmItem,
} from "@/shared/components/write-confirm-dialog";
import { useStudioStore } from "@/shared/store";

/** What to ask about. `description`, `title` and `confirm_label` are the
 *  dialog's own wording, for the surface that is asking. */
export interface WriteConfirmRequest {
  items: ConfirmItem[];
  description: string;
  title?: string;
  confirm_label?: string;
}

interface Pending extends WriteConfirmRequest {
  resolve: (ok: boolean) => void;
}

/** The one place a write asks for confirmation (spec 0007). Whether to ask
 *  comes from the connection: a Production label, or Confirm before writes.
 *  A read only connection never asks, because the backend refuses the write
 *  and that refusal is the answer (it must never look like a write that a
 *  confirm could allow).
 *
 *  - `needs`: this connection asks before writes. A surface uses it to add
 *    the environment reason to what it already asks about.
 *  - `ask(request)`: always shows the dialog, resolves true on confirm.
 *  - `confirm_write(what)`: asks only when the connection needs it, resolves
 *    true at once otherwise. For a surface with nothing of its own to ask.
 *  - `dialog`: render this once, anywhere in the component. */
export function useWriteConfirm(conn_id: string): {
  needs: boolean;
  env_reason: string | null;
  ask: (request: WriteConfirmRequest) => Promise<boolean>;
  confirm_write: (what: string, description?: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const needs = !!conn && !conn.read_only && needsWriteConfirm(conn);
  const env_reason = needs && conn ? envConfirmReason(conn) : null;
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = useCallback(
    (request: WriteConfirmRequest) =>
      new Promise<boolean>((resolve) => setPending({ ...request, resolve })),
    [],
  );

  const confirm_write = useCallback(
    (
      what: string,
      description = "This change will be written to the database.",
    ) => {
      if (!needs || !env_reason) return Promise.resolve(true);
      return ask({
        items: [{ text: what, reasons: [env_reason] }],
        description,
        confirm_label: "Apply",
        title: "Confirm before applying",
      });
    },
    [needs, env_reason, ask],
  );

  const settle = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const dialog = (
    <WriteConfirmDialog
      items={pending?.items ?? null}
      description={pending?.description ?? ""}
      title={pending?.title}
      confirmLabel={pending?.confirm_label}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { needs, env_reason, ask, confirm_write, dialog };
}
