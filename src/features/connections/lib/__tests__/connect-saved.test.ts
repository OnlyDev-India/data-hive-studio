import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

const { api, flags } = vi.hoisted(() => ({
  api: {
    connectPostgres: vi.fn(),
    connectMongo: vi.fn(),
    openDatabasePath: vi.fn(),
  },
  flags: { web: false },
}));

vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/web")>()),
  get WEB() {
    return flags.web;
  },
}));
vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  ...api,
}));

import { useStudioStore, type SavedConnParams } from "@/shared/store";
import { pgConnectParams, mongoConnectParams } from "../build-params";
import { mongoFormFromSaved, pgFormFromSaved } from "../from-saved";
import { connectSaved, needsPassword } from "../connect-saved";

const pgSaved: SavedConnParams = {
  kind: "postgres",
  name: "Orders",
  host: "db.example",
  port: 5433,
  user: "app",
  password: "stored",
  database: "orders",
};

const mongoSaved: SavedConnParams = {
  kind: "mongodb",
  name: "Events",
  host: "mongo.example",
  port: 27017,
  user: "reader",
  password: "",
  database: "events",
  auth_db: "admin",
};

const sqliteSaved: SavedConnParams = {
  kind: "sqlite",
  name: "local.db",
  host: "",
  port: 0,
  user: "",
  password: "",
  database: "",
  source_path: "/tmp/local.db",
};

let openConn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  flags.web = false;
  localStorage.clear();
  api.connectPostgres
    .mockReset()
    .mockResolvedValue({ id: "p1", name: "orders", kind: "postgres" });
  api.connectMongo
    .mockReset()
    .mockResolvedValue({ id: "m1", name: "events", kind: "mongodb" });
  api.openDatabasePath
    .mockReset()
    .mockResolvedValue({ id: "s1", name: "local.db", kind: "sqlite" });
  openConn = vi.fn();
  useStudioStore.setState({
    open: [],
    recentParams: {},
    savedLocal: { Orders: pgSaved },
    pgConnecting: false,
    mongoConnecting: false,
    openConn,
  });
});

describe("connectSaved", () => {
  // covers: AC-22, AC-16
  it("connects PostgreSQL with the same payload the form would send", async () => {
    const conn = await connectSaved("postgres", pgSaved);
    expect(api.connectPostgres).toHaveBeenCalledWith(
      pgConnectParams(pgFormFromSaved(pgSaved)),
    );
    expect(openConn).toHaveBeenCalledWith(conn);
    expect(useStudioStore.getState().recentParams.p1).toMatchObject({
      kind: "postgres",
      name: "Orders",
      host: "db.example",
    });
    expect(useStudioStore.getState().pgConnecting).toBe(false);
  });

  // covers: AC-25
  it("uses the prompt password instead of the stored one", async () => {
    await connectSaved("postgres", pgSaved, "typed");
    expect(api.connectPostgres.mock.calls[0][0].password).toBe("typed");
  });

  // covers: AC-25
  it("never writes a prompt password to storage on the web", async () => {
    flags.web = true;
    const saved = { ...pgSaved, password: "" };
    useStudioStore.setState({ savedLocal: { Orders: saved } });
    await connectSaved("postgres", saved, "typed");
    expect(localStorage.getItem("pg.recents")).not.toContain("typed");
    expect(useStudioStore.getState().savedLocal.Orders.password).toBe("");
  });

  // covers: AC-22, AC-16
  it("connects MongoDB and records a DocumentDB recent under its own kind", async () => {
    const docdb = { ...mongoSaved, kind: "documentdb" as const };
    await connectSaved("documentdb", docdb);
    expect(api.connectMongo).toHaveBeenCalledWith(
      mongoConnectParams(mongoFormFromSaved(docdb)),
    );
    expect(useStudioStore.getState().recentParams.m1.kind).toBe("documentdb");
    expect(useStudioStore.getState().mongoConnecting).toBe(false);
  });

  it("opens a plain SQLite file without a guard, and a read only one with it", async () => {
    await connectSaved("sqlite", sqliteSaved);
    expect(api.openDatabasePath).toHaveBeenLastCalledWith("/tmp/local.db");
    await connectSaved("sqlite", { ...sqliteSaved, read_only: true });
    expect(api.openDatabasePath).toHaveBeenLastCalledWith(
      "/tmp/local.db",
      expect.objectContaining({ read_only: true }),
    );
    expect(openConn).toHaveBeenCalledTimes(2);
  });

  it("refuses a SQLite entry with no file path", async () => {
    await expect(
      connectSaved("sqlite", { ...sqliteSaved, source_path: undefined }),
    ).rejects.toThrow("This connection has no file path.");
    expect(api.openDatabasePath).not.toHaveBeenCalled();
  });

  it("runs beforeOpen after connecting and before the workspace opens", async () => {
    const order: string[] = [];
    api.connectPostgres.mockImplementation(async () => {
      order.push("connect");
      return { id: "p1", name: "orders", kind: "postgres" };
    });
    openConn.mockImplementation(() => order.push("open"));
    await connectSaved("postgres", pgSaved, undefined, async () => {
      order.push("before");
    });
    expect(order).toEqual(["connect", "before", "open"]);
  });

  // covers: AC-26
  it("throws the backend error, opens nothing and clears the busy flag", async () => {
    api.connectPostgres.mockRejectedValue("password authentication failed");
    await expect(connectSaved("postgres", pgSaved)).rejects.toBe(
      "password authentication failed",
    );
    expect(openConn).not.toHaveBeenCalled();
    expect(useStudioStore.getState().recentParams).toEqual({});
    expect(useStudioStore.getState().pgConnecting).toBe(false);
  });

  it("clears the Mongo busy flag on failure too", async () => {
    api.connectMongo.mockRejectedValue("timeout");
    await expect(connectSaved("mongodb", mongoSaved)).rejects.toBe("timeout");
    expect(useStudioStore.getState().mongoConnecting).toBe(false);
  });
});

describe("needsPassword", () => {
  // covers: AC-25
  it("asks on the web when no password was remembered", () => {
    expect(needsPassword({ password: "" }, true)).toBe(true);
    expect(needsPassword({}, true)).toBe(true);
    expect(needsPassword({ password: "pw" }, true)).toBe(false);
  });

  it("asks on the desktop when the keychain read failed or it wasn't remembered", () => {
    expect(needsPassword({ password: "" }, false)).toBe(false);
    expect(needsPassword({ password: "", remember_secret: true }, false)).toBe(
      false,
    );
    expect(needsPassword({ password: "", secret_missing: true }, false)).toBe(
      true,
    );
    expect(
      needsPassword({ password: "pw", remember_secret: false }, false),
    ).toBe(true);
  });

  it("never asks for SQLite", () => {
    expect(
      needsPassword(
        { kind: "sqlite", password: "", secret_missing: true },
        false,
      ),
    ).toBe(false);
    expect(needsPassword({ kind: "sqlite", password: "" }, true)).toBe(false);
  });
});
