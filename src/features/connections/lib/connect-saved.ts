import {
  connectMongo,
  connectPostgres,
  openDatabasePath,
  type ConnGuard,
  type ConnectionInfo,
  type SavedDbKind,
} from "@/shared/api";
import { useStudioStore, type SavedConnParams } from "@/shared/store";
import {
  mongoConnectParams,
  mongoKindOf,
  pgConnectParams,
} from "./build-params";
import type { MongoFormValues, PgFormValues } from "./form-values";
import { mongoFormFromSaved, pgFormFromSaved } from "./from-saved";
import { guardFromForm, guardToForm, isPlainGuard } from "./guard-form";

/** Runs after a successful connect, before the workspace opens. */
type BeforeOpen = () => Promise<void>;

export async function connectPg(
  pg: PgFormValues,
  beforeOpen?: BeforeOpen,
): Promise<ConnectionInfo> {
  const st = useStudioStore.getState();
  st.setPgConnecting(true);
  try {
    const params = pgConnectParams(pg);
    const conn = await connectPostgres(params);
    st.pushRecentParams(conn.id, {
      ...params,
      kind: "postgres",
      name: pg.name.trim() || undefined,
    });
    await beforeOpen?.();
    st.openConn(conn);
    return conn;
  } finally {
    useStudioStore.getState().setPgConnecting(false);
  }
}

export async function connectMongoForm(
  mongo: MongoFormValues,
  kind: SavedDbKind,
  beforeOpen?: BeforeOpen,
): Promise<ConnectionInfo> {
  const st = useStudioStore.getState();
  st.setMongoConnecting(true);
  try {
    const params = mongoConnectParams(mongo);
    const conn = await connectMongo(params);
    // Before openConn: its dedup reads recentParams.
    st.pushRecentParams(conn.id, {
      ...params,
      kind: mongoKindOf(kind),
      name: mongo.name.trim() || undefined,
    });
    await beforeOpen?.();
    st.openConn(conn);
    return conn;
  } finally {
    useStudioStore.getState().setMongoConnecting(false);
  }
}

export async function openSqliteFile(
  path: string,
  guard: ConnGuard,
  beforeOpen?: BeforeOpen,
): Promise<ConnectionInfo> {
  const conn = isPlainGuard(guard)
    ? await openDatabasePath(path)
    : await openDatabasePath(path, guard);
  await beforeOpen?.();
  useStudioStore.getState().openConn(conn);
  return conn;
}

/** Connect a saved or recent entry without the form. Throws the backend error. */
export async function connectSaved(
  kind: SavedDbKind,
  params: SavedConnParams,
  password?: string,
  beforeOpen?: BeforeOpen,
): Promise<ConnectionInfo> {
  const p = password === undefined ? params : { ...params, password };
  if (kind === "sqlite") {
    if (!p.source_path) throw new Error("This connection has no file path.");
    const guard = guardFromForm(guardToForm(p));
    return openSqliteFile(p.source_path, guard, beforeOpen);
  }
  if (kind === "postgres") return connectPg(pgFormFromSaved(p), beforeOpen);
  return connectMongoForm(mongoFormFromSaved(p), kind, beforeOpen);
}

/** Ask when the password wasn't remembered or isn't saved. */
export function needsPassword(
  params: {
    kind?: SavedDbKind;
    password?: string;
    remember_secret?: boolean;
    secret_missing?: boolean;
  },
  web: boolean,
) {
  if (params.kind === "sqlite") return false;
  if (web) return !params.password;
  return params.remember_secret === false || params.secret_missing === true;
}

export function uniqueCopyName(name: string, taken: Record<string, unknown>) {
  let target = `${name} copy`;
  for (let i = 2; target in taken; i++) target = `${name} copy ${i}`;
  return target;
}
