import { useState } from "react";
import {
  closeConnection,
  connectMongo,
  connectPostgres,
  type ConnGuard,
  type ConnectionInfo,
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { useStudioStore, type SavedConnParams } from "@/shared/store";
import {
  mongoConnectParams,
  mongoDisplayName,
  mongoSavedParams,
  pgConnectParams,
  pgDisplayName,
  pgSavedParams,
  sqliteDisplayName,
  sqliteSavedParams,
} from "../../lib/build-params";
import {
  connectMongoForm,
  connectPg,
  openSqliteFile,
} from "../../lib/connect-saved";
import { currentDraft, useConnectionDrafts } from "../../lib/drafts";
import { guardFromForm } from "../../lib/guard-form";
import { guardsDiffer, savedNameFor } from "../../lib/pending-change";
import type { FormTabKey } from "../../lib/tab-fields";
import { firstErrorTab, validateForm } from "../../lib/validate-form";

export type TestResult = { ok: true } | { ok: false; error: string } | null;

function liveFor(name: string): ConnectionInfo[] {
  const st = useStudioStore.getState();
  return st.open.filter(
    (c) => savedNameFor(c, st.recentParams[c.id], st.savedLocal) === name,
  );
}

function toSave(): { name: string; params: SavedConnParams; guard: ConnGuard } {
  const s = useConnectionDrafts.getState();
  if (s.kind === "sqlite") {
    return {
      name: sqliteDisplayName(s.sqlite),
      params: sqliteSavedParams({ ...s.sqlite, path: s.sqlite.path ?? "" }),
      guard: guardFromForm(s.sqlite.guard),
    };
  }
  if (s.kind === "postgres") {
    return {
      name: pgDisplayName(s.pg),
      params: pgSavedParams(s.pg),
      guard: guardFromForm(s.pg),
    };
  }
  return {
    name: mongoDisplayName(s.mongo),
    params: mongoSavedParams(s.mongo, s.kind),
    guard: guardFromForm(s.mongo),
  };
}

export function useFormActions(onInvalid: (tab: FormTabKey) => void) {
  const [checked, setChecked] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult>(null);
  const [opening, setOpening] = useState(false);
  const [reconnectIds, setReconnectIds] = useState<string[] | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const pgConnecting = useStudioStore((s) => s.pgConnecting);
  const mongoConnecting = useStudioStore((s) => s.mongoConnecting);

  const valid = () => {
    const s = useConnectionDrafts.getState();
    const errors = validateForm(currentDraft(s));
    if (errors.length === 0) return true;
    setChecked(true);
    const tab = firstErrorTab(s.kind, errors);
    if (tab) onInvalid(tab);
    return false;
  };

  const runTest = async () => {
    if (testing || !valid()) return;
    const s = useConnectionDrafts.getState();
    setTesting(true);
    setTest(null);
    try {
      const conn =
        s.kind === "postgres"
          ? await connectPostgres(pgConnectParams(s.pg))
          : await connectMongo(mongoConnectParams(s.mongo));
      await closeConnection(conn.id);
      setTest({ ok: true });
    } catch (e) {
      setTest({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const connect = async () => {
    const s = useConnectionDrafts.getState();
    const notify = useStudioStore.getState().pushNotification;
    try {
      if (s.kind === "sqlite") {
        if (opening) return;
        setOpening(true);
        await openSqliteFile(
          s.sqlite.path ?? "",
          guardFromForm(s.sqlite.guard),
        );
      } else if (s.kind === "postgres") {
        if (useStudioStore.getState().pgConnecting) return;
        await connectPg(s.pg);
      } else {
        if (useStudioStore.getState().mongoConnecting) return;
        await connectMongoForm(s.mongo, s.kind);
      }
      useConnectionDrafts.getState().reset();
    } catch (e) {
      notify({
        kind: "error",
        title:
          s.kind === "sqlite" ? "Failed to open database" : "Connection failed",
        detail: String(e),
      });
    } finally {
      setOpening(false);
    }
  };

  const runConnect = async () => {
    if (valid()) await connect();
  };

  const runSave = async () => {
    if (!valid()) return;
    const st = useStudioStore.getState();
    const { edit, setEdit } = useConnectionDrafts.getState();
    const { name, params, guard } = toSave();
    try {
      if (edit) {
        const live = liveFor(edit.oldName);
        await st.updateSavedLocal(edit.oldName, name, params);
        st.pushNotification({
          kind: "success",
          title: "Updated saved connection",
          detail: name,
        });
        const stale = live
          .filter((c) => guardsDiffer(c, guard))
          .map((c) => c.id);
        if (stale.length > 0) setReconnectIds(stale);
      } else {
        await st.saveLocal(name, params);
        st.pushNotification({
          kind: "success",
          title: WEB ? "Saved in this browser" : "Saved on this device",
          detail: name,
        });
      }
      setEdit({ oldName: name, name });
    } catch (e) {
      st.pushNotification({
        kind: "error",
        title: "Save failed",
        detail: String(e),
      });
    }
  };

  const reconnectNow = async () => {
    if (!reconnectIds) return;
    setReconnecting(true);
    try {
      // A connection with different flags is a different session, so the
      // old one has to close first.
      for (const id of reconnectIds) {
        try {
          await closeConnection(id);
        } catch {
          /* already gone */
        }
        useStudioStore.getState().closeConn(id);
      }
      setReconnectIds(null);
      await connect();
    } finally {
      setReconnecting(false);
    }
  };

  const kind = useConnectionDrafts((s) => s.kind);
  const connecting =
    kind === "sqlite"
      ? opening
      : kind === "postgres"
        ? pgConnecting
        : mongoConnecting;

  return {
    checked,
    testing,
    test,
    connecting,
    runTest,
    runSave,
    runConnect,
    reconnect: {
      ids: reconnectIds,
      busy: reconnecting,
      now: reconnectNow,
      later: () => setReconnectIds(null),
    },
  };
}
