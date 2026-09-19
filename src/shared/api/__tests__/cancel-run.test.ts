import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// `WEB` is fixed at import time, so each case loads a fresh module graph.
async function loadQuery(web: boolean) {
  vi.resetModules();
  vi.doMock("../web", () => ({
    WEB: web,
    wcall: vi.fn(),
    webServerConfig: vi.fn(),
    apiUrl: vi.fn().mockReturnValue(""),
  }));
  return import("../query");
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.resetModules();
});

describe("canCancelRun", () => {
  it("offers Stop on local desktop SQLite, PostgreSQL and MongoDB connections", async () => {
    const { canCancelRun } = await loadQuery(false);
    expect(canCancelRun("local-1", "sqlite")).toBe(true);
    expect(canCancelRun("local-1", "postgres")).toBe(true);
    expect(canCancelRun("local-1", "mongodb")).toBe(true);
  });

  it("does not offer Stop for engines the backend cannot cancel yet", async () => {
    const { canCancelRun } = await loadQuery(false);
    expect(canCancelRun("local-1", "documentdb")).toBe(false);
    expect(canCancelRun("local-1", "mysql")).toBe(false);
    expect(canCancelRun("local-1", undefined)).toBe(false);
  });

  it("does not offer Stop on team server connections", async () => {
    const { canCancelRun } = await loadQuery(false);
    expect(canCancelRun("srv:p1:c1", "postgres")).toBe(false);
  });

  it("does not offer Stop in the web build", async () => {
    const { canCancelRun } = await loadQuery(true);
    expect(canCancelRun("local-1", "sqlite")).toBe(false);
  });
});

async function tauriInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  const mock = invoke as unknown as Mock;
  mock.mockReset();
  return mock;
}

describe("cancelRun", () => {
  it("asks the backend to stop that run on that connection", async () => {
    const { cancelRun } = await loadQuery(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({ state: "stopped" });

    const outcome = await cancelRun("local-1", "run-7");

    expect(invoke).toHaveBeenCalledWith("cancel_run", {
      connId: "local-1",
      runId: "run-7",
    });
    expect(outcome).toEqual({ state: "stopped" });
  });

  it.each(["stopped", "winding_down", "not_running"] as const)(
    "hands back the %s outcome unchanged",
    async (state) => {
      const { cancelRun } = await loadQuery(false);
      const invoke = await tauriInvoke();
      invoke.mockResolvedValueOnce({ state });

      await expect(cancelRun("local-1", "run-7")).resolves.toEqual({ state });
    },
  );

  it("rejects for a team server connection without calling the backend", async () => {
    const { cancelRun } = await loadQuery(false);
    const invoke = await tauriInvoke();

    await expect(cancelRun("srv:p1:c1", "run-7")).rejects.toThrow(
      /team-server/,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects in the web build without calling the backend", async () => {
    const { cancelRun } = await loadQuery(true);
    const invoke = await tauriInvoke();

    await expect(cancelRun("local-1", "run-7")).rejects.toThrow(/desktop app/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("passes a backend failure on to the caller", async () => {
    const { cancelRun } = await loadQuery(false);
    const invoke = await tauriInvoke();
    invoke.mockRejectedValueOnce(new Error("ipc down"));

    await expect(cancelRun("local-1", "run-7")).rejects.toThrow("ipc down");
  });
});

describe("runSqlStream run id", () => {
  const stoppedResult = {
    columns: [],
    rows: [],
    rows_affected: 0,
    is_select: true,
    error: null,
    elapsed_ms: 4200,
    cancelled: true,
  };

  async function loadStreaming(web: boolean) {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: web,
      wcall: vi.fn(),
      webServerConfig: vi.fn(),
      apiUrl: vi.fn().mockReturnValue(""),
    }));
    return import("../streaming");
  }

  it("sends the run id to the streaming command so the run can be stopped", async () => {
    const { runSqlStream } = await loadStreaming(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce(stoppedResult);

    await runSqlStream("local-1", "select 1", undefined, "shop", "public", "run-7");

    expect(invoke).toHaveBeenCalledWith(
      "run_sql_stream",
      expect.objectContaining({
        connId: "local-1",
        sql: "select 1",
        database: "shop",
        schema: "public",
        runId: "run-7",
      }),
    );
  });

  it("leaves the run id out when the caller has none (not stoppable)", async () => {
    const { runSqlStream } = await loadStreaming(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({ ...stoppedResult, cancelled: false });

    await runSqlStream("local-1", "select 1");

    expect(invoke.mock.calls[0][1].runId).toBeUndefined();
  });

  it("resolves a stopped run with cancelled set, after the rows that had arrived", async () => {
    const { runSqlStream } = await loadStreaming(false);
    const invoke = await tauriInvoke();
    invoke.mockImplementationOnce(async (_cmd: string, args: unknown) => {
      const { channel } = args as {
        channel: { onmessage: (chunk: unknown) => void };
      };
      channel.onmessage({ columns: ["n"], rows: [] });
      channel.onmessage({ rows: [["1"], ["2"]] });
      return stoppedResult;
    });
    const seen: unknown[] = [];

    const res = await runSqlStream("local-1", "select n", (c) => seen.push(c), undefined, undefined, "run-7");

    expect(seen).toEqual([{ columns: ["n"], rows: [] }, { rows: [["1"], ["2"]] }]);
    expect(res.cancelled).toBe(true);
    expect(res.error).toBeNull();
  });

  it("does not use the streaming command on a team server connection", async () => {
    const { runSqlStream } = await loadStreaming(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({ ...stoppedResult, cancelled: false });

    await runSqlStream("srv:p1:c1", "select 1", undefined, undefined, undefined, "run-7");

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe("server_run_sql");
  });
});

describe("runMongo run id", () => {
  async function loadConnection(web: boolean) {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: web,
      wcall: vi.fn(),
      webServerConfig: vi.fn(),
      apiUrl: vi.fn().mockReturnValue(""),
    }));
    return import("../connection");
  }

  it("sends the run id to the console command so the run can be stopped", async () => {
    const { runMongo } = await loadConnection(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({ cancelled: true });

    const res = await runMongo("local-1", "shop", "users", "db.users.find({})", "run-9");

    expect(invoke).toHaveBeenCalledWith("run_mongo", {
      connId: "local-1",
      database: "shop",
      collection: "users",
      script: "db.users.find({})",
      runId: "run-9",
    });
    expect(res.cancelled).toBe(true);
  });

  it("leaves the run id out when the caller has none", async () => {
    const { runMongo } = await loadConnection(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({});

    await runMongo("local-1", "shop", null, "show collections");

    expect(invoke.mock.calls[0][1].runId).toBeUndefined();
  });
});
