import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEY_REJECTED_EVENT,
  clearWebKey,
  resetWebConnections,
  setWebKey,
  wcall,
  webClose,
  webConnect,
  webInfo,
  webKey,
} from "../web";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const unknownHandle = () => json(404, { error: "unknown_handle" });

let fetchMock: ReturnType<typeof vi.fn>;
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    method: (init as RequestInit).method,
    headers: (init as RequestInit).headers as Record<string, string>,
    body: (init as RequestInit).body as string | undefined,
  }));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetWebConnections();
  clearWebKey();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const details = { kind: "postgres", host: "db", password: "pw" };

describe("connecting", () => {
  it("posts the details once and uses the handle as the connection id", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { handle: "h1" }));
    const id = await webConnect(details);
    expect(id).toBe("h1");
    expect(calls()[0]).toMatchObject({ url: "/v1/connect", method: "POST" });
    expect(JSON.parse(calls()[0].body!)).toEqual(details);
  });

  it("says which field the server refused", async () => {
    fetchMock.mockResolvedValueOnce(
      json(422, { error: "unsupported_field", field: "ssl_ca_file" }),
    );
    await expect(webConnect(details)).rejects.toThrow(/ssl_ca_file/);
  });

  it("passes on a database that could not be reached", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("connection refused", { status: 502 }),
    );
    await expect(webConnect(details)).rejects.toThrow(
      /502.*connection refused/,
    );
  });
});

describe("a handle the server forgot (AC-3)", () => {
  it("reconnects once with the saved details and repeats the call once", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { handle: "h1" })) // connect
      .mockResolvedValueOnce(unknownHandle()) // first try
      .mockResolvedValueOnce(json(200, { handle: "h2" })) // reconnect
      .mockResolvedValueOnce(json(200, ["orders"])); // repeat
    const id = await webConnect(details);

    await expect(wcall("GET", `/v1/c/${id}/tables`)).resolves.toEqual([
      "orders",
    ]);

    const c = calls();
    expect(c.map((x) => x.url)).toEqual([
      "/v1/connect",
      "/v1/c/h1/tables",
      "/v1/connect",
      "/v1/c/h2/tables",
    ]);
    expect(JSON.parse(c[2].body!)).toEqual(details);
  });

  it("keeps using the new handle for later calls under the same id", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { handle: "h1" }))
      .mockResolvedValueOnce(unknownHandle())
      .mockResolvedValueOnce(json(200, { handle: "h2" }))
      .mockResolvedValueOnce(json(200, []))
      .mockResolvedValueOnce(json(200, []));
    const id = await webConnect(details);
    await wcall("GET", `/v1/c/${id}/tables`);
    await wcall("GET", `/v1/c/${id}/schemas`);
    expect(calls().at(-1)!.url).toBe("/v1/c/h2/schemas");
  });

  it("shows a second 404 as an error instead of looping", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { handle: "h1" }))
      .mockResolvedValueOnce(unknownHandle())
      .mockResolvedValueOnce(json(200, { handle: "h2" }))
      .mockResolvedValueOnce(unknownHandle());
    const id = await webConnect(details);
    await expect(wcall("GET", `/v1/c/${id}/tables`)).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("makes one reconnect for calls that fail at the same time", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/v1/connect") return json(200, { handle: "h2" });
      return url.startsWith("/v1/c/h1/") ? unknownHandle() : json(200, []);
    });
    fetchMock.mockResolvedValueOnce(json(200, { handle: "h1" }));
    const id = await webConnect(details);
    await Promise.all([
      wcall("GET", `/v1/c/${id}/tables`),
      wcall("GET", `/v1/c/${id}/schemas`),
    ]);
    expect(calls().filter((x) => x.url === "/v1/connect")).toHaveLength(2); // first connect + one reconnect
  });

  it("does not retry an ordinary 404", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { handle: "h1" }))
      .mockResolvedValueOnce(new Response("no such table", { status: 404 }));
    const id = await webConnect(details);
    await expect(wcall("GET", `/v1/c/${id}/schema/x`)).rejects.toThrow(
      /no such table/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("closing", () => {
  it("frees the pool on the current handle and forgets the details", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { handle: "h1" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const id = await webConnect(details);
    await webClose(id);
    expect(calls()[1]).toMatchObject({ url: "/v1/c/h1/close", method: "POST" });
  });
});

describe("the access key (AC-5)", () => {
  it("is sent as a Bearer header once set, and info is asked for without it", async () => {
    setWebKey("s3cret");
    fetchMock
      .mockResolvedValueOnce(
        json(200, { key_required: true, read_only: false }),
      )
      .mockResolvedValueOnce(json(200, { handle: "h1" }));
    await webInfo();
    await webConnect(details);
    expect(calls()[0].headers.Authorization).toBeUndefined();
    expect(calls()[1].headers.Authorization).toBe("Bearer s3cret");
  });

  it("keeps the key in this tab's sessionStorage", () => {
    setWebKey("abc");
    expect(sessionStorage.getItem("dh.web.key")).toBe("abc");
    expect(webKey()).toBe("abc");
    expect(localStorage.getItem("dh.web.key")).toBeNull();
  });

  it("clears the key and asks for it again when the server answers 401", async () => {
    setWebKey("old");
    const rejected = vi.fn();
    window.addEventListener(KEY_REJECTED_EVENT, rejected);
    fetchMock.mockResolvedValueOnce(
      new Response("access key required", { status: 401 }),
    );
    await expect(webConnect(details)).rejects.toThrow(/401/);
    window.removeEventListener(KEY_REJECTED_EVENT, rejected);
    expect(rejected).toHaveBeenCalledOnce();
    expect(webKey()).toBeNull();
  });
});
