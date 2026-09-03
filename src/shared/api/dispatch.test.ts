import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// `WEB` in ./web is `!(window has __TAURI_INTERNALS__)`, which is always
// true under jsdom — so it's mocked per-test below via vi.doMock +
// vi.resetModules + dynamic import, to exercise both the desktop (WEB=false)
// and web (WEB=true) branches of dispatchDbCall.
async function loadDispatch(web: boolean) {
  vi.resetModules();
  vi.doMock("./web", () => ({
    WEB: web,
    wcall: vi.fn().mockResolvedValue({ mocked: "http-result" }),
    webServerConfig: vi.fn().mockReturnValue({
      url: "https://team.example",
      token: "tok123",
    }),
    apiUrl: vi.fn().mockReturnValue(""),
  }));
  return import("./dispatch");
}

afterEach(() => {
  vi.doUnmock("./web");
  vi.resetModules();
});

describe("connection id helpers", () => {
  it("srvConnId namespaces a remote id under its profile", async () => {
    const { srvConnId } = await loadDispatch(false);
    expect(srvConnId("p1", "c1")).toBe("srv:p1:c1");
  });

  it("isServerConn recognizes only well-formed srv:profile:conn ids", async () => {
    const { isServerConn } = await loadDispatch(false);
    expect(isServerConn("srv:p1:c1")).toBe(true);
    expect(isServerConn("srv:p1:")).toBe(false);
    expect(isServerConn("srv::c1")).toBe(false);
    expect(isServerConn("local-id")).toBe(false);
    expect(isServerConn("srv:p1:c1:extra")).toBe(false);
  });

  it("remoteOf/profileOf extract the two id segments", async () => {
    const { remoteOf, profileOf } = await loadDispatch(false);
    expect(profileOf("srv:p1:c1")).toBe("p1");
    expect(remoteOf("srv:p1:c1")).toBe("c1");
  });
});

describe("serverUnsupported", () => {
  it("throws for a server connection", async () => {
    const { serverUnsupported } = await loadDispatch(false);
    expect(() => serverUnsupported("srv:p1:c1")).toThrow(/team-server/);
  });

  it("throws in WEB mode even for a local-looking id", async () => {
    const { serverUnsupported } = await loadDispatch(true);
    expect(() => serverUnsupported("local-id")).toThrow(/desktop app/);
  });

  it("does not throw for a local connection on desktop", async () => {
    const { serverUnsupported } = await loadDispatch(false);
    expect(() => serverUnsupported("local-id")).not.toThrow();
  });
});

describe("dispatchDbCall", () => {
  const opts = () => ({
    httpMethod: "GET" as const,
    httpPath: (id: string) => `/v1/c/${id}/tables`,
    serverCmd: "server_list_tables",
    localCmd: "list_tables",
    args: { connId: "x" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("desktop + local connection: calls the plain Tauri command", async () => {
    const dispatch = await loadDispatch(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(["t1"]);

    const result = await dispatch.dispatchDbCall("local-id", opts());
    expect(invoke).toHaveBeenCalledWith("list_tables", { connId: "x" });
    expect(result).toEqual(["t1"]);
  });

  it("desktop + server connection: forwards to the server_* passthrough command", async () => {
    const dispatch = await loadDispatch(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(["t2"]);

    await dispatch.dispatchDbCall("srv:p1:c1", opts());
    expect(invoke).toHaveBeenCalledWith("server_list_tables", { connId: "x" });
  });

  it("web + server connection: goes over HTTP with per-server auth", async () => {
    const dispatch = await loadDispatch(true);
    const web = await import("./web");

    const result = await dispatch.dispatchDbCall("srv:p1:c1", opts());
    expect(web.wcall).toHaveBeenCalledWith(
      "GET",
      "/v1/c/c1/tables",
      undefined,
      "https://team.example",
      "tok123",
    );
    expect(result).toEqual({ mocked: "http-result" });
  });

  it("web + local-looking connection: goes over HTTP without per-server auth args", async () => {
    const dispatch = await loadDispatch(true);
    const web = await import("./web");

    await dispatch.dispatchDbCall("local-id", opts());
    // remoteOf("local-id") is "" since it has no srv: segments.
    expect(web.wcall).toHaveBeenCalledWith("GET", "/v1/c//tables", undefined);
  });
});

describe("dedupe", () => {
  it("collapses concurrent calls with the same key into one run", async () => {
    const { dedupe } = await loadDispatch(false);
    const run = vi.fn().mockResolvedValue("result");
    const [a, b] = await Promise.all([
      dedupe("key1", run),
      dedupe("key1", run),
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(a).toBe("result");
    expect(b).toBe("result");
  });

  it("does not collapse calls with different keys", async () => {
    const { dedupe } = await loadDispatch(false);
    const run = vi.fn().mockResolvedValue("result");
    await Promise.all([dedupe("key1", run), dedupe("key2", run)]);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
