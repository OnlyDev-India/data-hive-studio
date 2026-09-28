import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

import {
  READ_ONLY_PREFIX,
  connGuardOf,
  isReadOnlyError,
  readOnlyHint,
  withReadOnlyHint,
} from "../read-only";

// `WEB` is fixed at import time, so each case loads a fresh module graph.
async function load() {
  vi.resetModules();
  vi.doMock("../web", () => ({
    WEB: false,
    wcall: vi.fn(),
    webServerConfig: vi.fn(),
    apiUrl: vi.fn().mockReturnValue(""),
  }));
  const invoke = (await import("@tauri-apps/api/core"))
    .invoke as unknown as Mock;
  invoke.mockReset();
  return {
    invoke,
    query: await import("../query"),
    streaming: await import("../streaming"),
    connection: await import("../connection"),
  };
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.resetModules();
});

const refusal = `${READ_ONLY_PREFIX} UPDATE statements are not allowed.`;

describe("isReadOnlyError", () => {
  it("recognises the backend's refusal in a string, an Error, or wrapped text", () => {
    expect(isReadOnlyError(refusal)).toBe(true);
    expect(isReadOnlyError(new Error(refusal))).toBe(true);
    expect(isReadOnlyError(`Error: ${refusal}`)).toBe(true);
  });

  it("does not mistake any other failure for one", () => {
    expect(isReadOnlyError("syntax error at or near UPDATE")).toBe(false);
    expect(isReadOnlyError(new Error("connection refused"))).toBe(false);
    expect(isReadOnlyError(undefined)).toBe(false);
    expect(isReadOnlyError(null)).toBe(false);
    expect(isReadOnlyError({ code: 1 })).toBe(false);
  });
});

describe("withReadOnlyHint", () => {
  it("tells a local connection to use its settings", () => {
    expect(withReadOnlyHint(refusal)).toBe(
      `${refusal} Turn off read only in the connection settings.`,
    );
  });

  it("adds nothing to the server's own read only switch", () => {
    const server =
      "Read only connection: this server is read only (DH_READ_ONLY).";
    expect(withReadOnlyHint(server)).toBe(server);
  });

  it("keeps a string a string and makes an Error a new Error", () => {
    expect(typeof withReadOnlyHint(refusal)).toBe("string");
    const original = new Error(refusal);
    const hinted = withReadOnlyHint(original);
    expect(hinted).toBeInstanceOf(Error);
    expect((hinted as Error).message).toContain(readOnlyHint());
    expect((hinted as Error).cause).toBe(original);
  });

  it("hints once, however many layers it passes through", () => {
    const once = withReadOnlyHint(refusal);
    expect(withReadOnlyHint(once)).toBe(once);
  });

  it("leaves every other error untouched", () => {
    const other = new Error("relation does not exist");
    expect(withReadOnlyHint(other)).toBe(other);
    expect(withReadOnlyHint("boom")).toBe("boom");
  });
});

describe("connGuardOf", () => {
  it("copies only the four guard fields", () => {
    const conn = {
      id: "c1",
      name: "prod",
      read_only: true,
      env_label: "Production",
      env_color: null,
      confirm_writes: true,
    };
    expect(connGuardOf(conn)).toEqual({
      read_only: true,
      env_label: "Production",
      env_color: null,
      confirm_writes: true,
    });
  });

  it("gives a connection saved before the feature an empty guard", () => {
    expect(connGuardOf({})).toEqual({});
  });
});

describe("the hint on real calls", () => {
  it("is added to a refused editor run on a local connection", async () => {
    const { invoke, streaming } = await load();
    invoke.mockRejectedValueOnce(refusal);

    await expect(
      streaming.runSqlStream("local-1", "UPDATE t SET a = 1"),
    ).rejects.toBe(`${refusal} Turn off read only in the connection settings.`);
  });

  it("is added to a refused grid write and to a refused grid Apply", async () => {
    const { invoke, query, streaming } = await load();
    invoke.mockRejectedValue(refusal);

    await expect(
      query.executeParams("local-1", "DELETE FROM t", []),
    ).rejects.toContain("connection settings");
    await expect(
      streaming.executeOpStream("local-1", { kind: "drop_table", table: "t" }),
    ).rejects.toContain("connection settings");
    await expect(
      query.executeOp("local-1", { kind: "drop_table", table: "t" }),
    ).rejects.toContain("connection settings");
  });

  it("leaves other failures exactly as they were", async () => {
    const { invoke, query } = await load();
    invoke.mockRejectedValueOnce("syntax error");

    await expect(query.runSql("local-1", "SELEC 1")).rejects.toBe(
      "syntax error",
    );
  });

  it("passes a result through untouched", async () => {
    const { invoke, query } = await load();
    invoke.mockResolvedValueOnce({ columns: [], rows: [] });

    await expect(query.runSql("local-1", "SELECT 1")).resolves.toEqual({
      columns: [],
      rows: [],
    });
  });
});

describe("openDatabasePath", () => {
  it("opens a normal file exactly as before when no guard is given", async () => {
    const { invoke, connection } = await load();
    invoke.mockResolvedValueOnce({ id: "c1" });

    await connection.openDatabasePath("/d/app.db");

    expect(invoke).toHaveBeenCalledWith("open_database_path", {
      path: "/d/app.db",
      guard: undefined,
    });
  });

  it("sends the guard so the backend opens the file read only", async () => {
    const { invoke, connection } = await load();
    invoke.mockResolvedValueOnce({ id: "c1" });

    await connection.openDatabasePath("/d/app.db", { read_only: true });

    expect(invoke).toHaveBeenCalledWith("open_database_path", {
      path: "/d/app.db",
      guard: { read_only: true },
    });
  });
});
