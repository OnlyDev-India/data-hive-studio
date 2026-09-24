import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// `WEB` in ../web is `!(window has __TAURI_INTERNALS__)`, which is always
// true under jsdom — so it's mocked per-test below via vi.doMock +
// vi.resetModules + dynamic import, to exercise both the desktop (WEB=false)
// and web (WEB=true) branches of dispatchDbCall.
async function loadDispatch(web: boolean) {
  vi.resetModules();
  vi.doMock("../web", () => ({
    WEB: web,
    wcall: vi.fn().mockResolvedValue({ mocked: "http-result" }),
  }));
  return import("../dispatch");
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.resetModules();
});

describe("serverUnsupported", () => {
  it("throws in the web build", async () => {
    const { serverUnsupported } = await loadDispatch(true);
    expect(() => serverUnsupported()).toThrow(/desktop app/);
  });

  it("does not throw on the desktop", async () => {
    const { serverUnsupported } = await loadDispatch(false);
    expect(() => serverUnsupported()).not.toThrow();
  });
});

describe("dispatchDbCall", () => {
  const opts = () => ({
    httpMethod: "GET" as const,
    httpPath: (id: string) => `/v1/c/${id}/tables`,
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

  it("web: goes over HTTP under the connection's handle", async () => {
    const dispatch = await loadDispatch(true);
    const web = await import("../web");

    const result = await dispatch.dispatchDbCall("handle-1", opts());
    expect(web.wcall).toHaveBeenCalledWith(
      "GET",
      "/v1/c/handle-1/tables",
      undefined,
    );
    expect(result).toEqual({ mocked: "http-result" });
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
