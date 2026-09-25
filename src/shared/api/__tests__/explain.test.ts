import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// `WEB` is fixed at import time, so each case loads a fresh module graph.
async function loadExplain(web: boolean) {
  vi.resetModules();
  const wcall = vi.fn();
  vi.doMock("../web", () => ({
    WEB: web,
    wcall,
    webServerConfig: vi.fn(),
    apiUrl: vi.fn().mockReturnValue(""),
  }));
  const mod = await import("../explain");
  return { ...mod, wcall };
}

async function tauriInvoke() {
  const { invoke } = await import("@tauri-apps/api/core");
  const mock = invoke as unknown as Mock;
  mock.mockReset();
  return mock;
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.resetModules();
});

describe("canExplain", () => {
  it("offers Explain on SQLite, PostgreSQL and MongoDB", async () => {
    const { canExplain } = await loadExplain(false);
    expect(canExplain("sqlite")).toBe(true);
    expect(canExplain("postgres")).toBe(true);
    expect(canExplain("mongodb")).toBe(true);
  });

  it("does not offer Explain for engines with no plan support", async () => {
    const { canExplain } = await loadExplain(false);
    expect(canExplain("mysql")).toBe(false);
    expect(canExplain("documentdb")).toBe(false);
    expect(canExplain(undefined)).toBe(false);
  });

  it("offers Explain in the web build too, through the server routes", async () => {
    const { canExplain } = await loadExplain(true);
    expect(canExplain("postgres")).toBe(true);
  });
});

describe("canExplainAnalyze", () => {
  it("offers Explain Analyze on PostgreSQL and MongoDB", async () => {
    const { canExplainAnalyze } = await loadExplain(false);
    expect(canExplainAnalyze("postgres")).toBe(true);
    expect(canExplainAnalyze("mongodb")).toBe(true);
  });

  it("hides Explain Analyze on SQLite, which has no timings", async () => {
    const { canExplainAnalyze } = await loadExplain(false);
    expect(canExplainAnalyze("sqlite")).toBe(false);
  });

  it("hides Explain Analyze when the engine cannot explain at all", async () => {
    const { canExplainAnalyze } = await loadExplain(false);
    expect(canExplainAnalyze("mysql")).toBe(false);
    expect(canExplainAnalyze(undefined)).toBe(false);
  });
});

describe("explainSql", () => {
  const plan = { dialect: "sqlite", mode: "estimate", root: null };

  it("asks the desktop backend for an estimate by default", async () => {
    const { explainSql } = await loadExplain(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce(plan);

    const res = await explainSql("local-1", "select 1");

    expect(invoke).toHaveBeenCalledWith("explain_sql", {
      connId: "local-1",
      database: null,
      schema: null,
      sql: "select 1",
      analyze: false,
      runId: null,
    });
    expect(res).toEqual(plan);
  });

  it("sends database, schema, analyze and the run id so the call can be stopped", async () => {
    const { explainSql } = await loadExplain(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce(plan);

    await explainSql("local-1", "select 1", "shop", "public", true, "run-3");

    expect(invoke).toHaveBeenCalledWith("explain_sql", {
      connId: "local-1",
      database: "shop",
      schema: "public",
      sql: "select 1",
      analyze: true,
      runId: "run-3",
    });
  });

  it("posts to the server explain route in the web build", async () => {
    const { explainSql, wcall } = await loadExplain(true);
    wcall.mockResolvedValueOnce(plan);

    await explainSql("h/1", "select 1", "shop", undefined, false, "run-3");

    expect(wcall).toHaveBeenCalledWith("POST", "/v1/c/h%2F1/explain", {
      sql: "select 1",
      analyze: false,
      database: "shop",
      schema: null,
      run_id: "run-3",
    });
  });

  it("passes a backend failure on to the caller", async () => {
    const { explainSql } = await loadExplain(false);
    const invoke = await tauriInvoke();
    invoke.mockRejectedValueOnce(new Error("ipc down"));

    await expect(explainSql("local-1", "select 1")).rejects.toThrow("ipc down");
  });

  it.each(["404 Not Found", "HTTP 404", "405 Method Not Allowed"])(
    "says the team server is too old when the web build gets %s",
    async (message) => {
      const { explainSql, wcall, OLD_SERVER_MESSAGE } = await loadExplain(true);
      wcall.mockRejectedValueOnce(new Error(message));

      await expect(explainSql("h1", "select 1")).rejects.toThrow(
        OLD_SERVER_MESSAGE,
      );
    },
  );

  it("leaves other web failures untouched", async () => {
    const { explainSql, wcall } = await loadExplain(true);
    wcall.mockRejectedValueOnce(new Error("500 boom"));

    await expect(explainSql("h1", "select 1")).rejects.toThrow("500 boom");
  });

  it("does not treat a status like 4041 as a missing route", async () => {
    const { explainSql, wcall, OLD_SERVER_MESSAGE } = await loadExplain(true);
    wcall.mockRejectedValueOnce(new Error("4041 odd"));

    await expect(explainSql("h1", "select 1")).rejects.not.toThrow(
      OLD_SERVER_MESSAGE,
    );
  });

  it("does not rewrite a 404 on the desktop, where there is no server", async () => {
    const { explainSql } = await loadExplain(false);
    const invoke = await tauriInvoke();
    invoke.mockRejectedValueOnce(new Error("404 missing"));

    await expect(explainSql("local-1", "select 1")).rejects.toThrow(
      "404 missing",
    );
  });
});

describe("explainMongo", () => {
  const script = "db.users.find({})";

  it("asks the desktop backend to explain the console command", async () => {
    const { explainMongo } = await loadExplain(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({ dialect: "mongodb" });

    await explainMongo("local-1", "shop", "users", script, true, "run-4");

    expect(invoke).toHaveBeenCalledWith("explain_mongo", {
      connId: "local-1",
      database: "shop",
      collection: "users",
      script,
      analyze: true,
      runId: "run-4",
    });
  });

  it("sends a null collection and no run id when there are none", async () => {
    const { explainMongo } = await loadExplain(false);
    const invoke = await tauriInvoke();
    invoke.mockResolvedValueOnce({ dialect: "mongodb" });

    await explainMongo("local-1", "shop", null, script);

    const args = invoke.mock.calls[0][1];
    expect(args.collection).toBeNull();
    expect(args.analyze).toBe(false);
    expect(args.runId).toBeNull();
  });

  it("posts to the server mongo explain route in the web build", async () => {
    const { explainMongo, wcall } = await loadExplain(true);
    wcall.mockResolvedValueOnce({ dialect: "mongodb" });

    await explainMongo("h1", "shop", "users", script);

    expect(wcall).toHaveBeenCalledWith("POST", "/v1/c/h1/mongo/explain", {
      database: "shop",
      collection: "users",
      script,
      analyze: false,
      run_id: null,
    });
  });

  it("says the team server is too old when the route is missing", async () => {
    const { explainMongo, wcall, OLD_SERVER_MESSAGE } = await loadExplain(true);
    wcall.mockRejectedValueOnce(new Error("404 Not Found"));

    await expect(explainMongo("h1", "shop", null, script)).rejects.toThrow(
      OLD_SERVER_MESSAGE,
    );
  });
});
