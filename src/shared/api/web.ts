/**
 * Browser build transport (spec 0010).
 *
 * In web mode there is no Tauri IPC: every call goes to the dh-server that
 * serves this page, over REST. The server has no accounts. It holds only live
 * database pools, and this page owns the saved connections (`localStorage`,
 * see `web-connections.ts`).
 *
 * To use a database the page sends its details once to `POST /v1/connect` and
 * gets a handle back. Every data call then runs under `/v1/c/{handle}/...`.
 * The store keeps the FIRST handle as the connection id for good, and this
 * module swaps in the current one, so when the server forgets a handle (a
 * restart, an idle close) the page reconnects once, quietly, with the details
 * it still holds in memory, and repeats the call once.
 *
 * When the server has an access key, the page asks for it and keeps it in
 * `sessionStorage` (this tab only) and sends it as a Bearer header.
 *
 * The page talks only to the server that served it (or, in development,
 * through vite's `/v1` proxy).
 */
import { readNdjson, type StreamEvent } from "./ndjson";
import type { QueryResult } from "./types";

export const WEB = !(
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
);

// ---------------------------------------------------------------------------
//  Access key
// ---------------------------------------------------------------------------

const KEY_STORAGE = "dh.web.key";

/** Fired when the server answers 401: the page shows the key prompt again. */
export const KEY_REJECTED_EVENT = "dh-web-key-rejected";

export function webKey(): string | null {
  try {
    return sessionStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setWebKey(key: string): void {
  try {
    sessionStorage.setItem(KEY_STORAGE, key);
  } catch {
    // storage unavailable: the key lives only until the next reload
    memoryKey = key;
  }
}

export function clearWebKey(): void {
  memoryKey = null;
  try {
    sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // nothing to clear
  }
}

let memoryKey: string | null = null;

function currentKey(): string | null {
  return webKey() ?? memoryKey;
}

// ---------------------------------------------------------------------------
//  Requests
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function raw(
  method: Method,
  path: string,
  body: unknown,
  withKey = true,
): Promise<Response> {
  const key = withKey ? currentKey() : null;
  return fetch(path, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export interface WebInfo {
  key_required: boolean;
  read_only: boolean;
}

/** What the server says about itself. The one route that needs no key. */
export async function webInfo(): Promise<WebInfo> {
  const res = await raw("GET", "/v1/info", undefined, false);
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as WebInfo;
}

/** Check a key by making a call that needs one. `true` when accepted. */
export async function webKeyAccepted(key: string): Promise<boolean> {
  const res = await fetch("/v1/c/none/close", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
  });
  // A right key reaches the handle lookup and finds nothing (404); a wrong one
  // is stopped by the guard (401).
  return res.status !== 401;
}

// ---------------------------------------------------------------------------
//  Handles
// ---------------------------------------------------------------------------

interface Entry {
  /** The body sent to /v1/connect, secrets included. Memory only. */
  details: Record<string, unknown>;
  handle: string;
  reconnecting: Promise<void> | null;
}

/** Connection id (the first handle) to what the page needs to reach it. */
const entries = new Map<string, Entry>();

const DATA_PATH = /^\/v1\/c\/([^/]+)(\/.*)?$/;

/** A refusal `POST /v1/connect` named, in words. */
function refusalText(status: number, text: string): string | null {
  if (status !== 422) return null;
  try {
    const parsed = JSON.parse(text) as { error?: string; field?: string };
    if (parsed.error === "unsupported_field") {
      return `The web version cannot use "${parsed.field}". Only PostgreSQL and MongoDB, and SSH by password, work here.`;
    }
  } catch {
    // not JSON: fall through
  }
  return null;
}

async function openHandle(details: Record<string, unknown>): Promise<string> {
  const res = await raw("POST", "/v1/connect", details);
  if (res.status === 401) rejectKey();
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(refusalText(res.status, text) ?? errorFrom(res, text));
  }
  return ((await res.json()) as { handle: string }).handle;
}

/** Open a connection and return its id. `details` is the body of
 *  `POST /v1/connect`; it stays in memory so the page can reconnect. */
export async function webConnect(
  details: Record<string, unknown>,
): Promise<string> {
  const handle = await openHandle(details);
  entries.set(handle, { details, handle, reconnecting: null });
  return handle;
}

/** Free a connection's pool on the server and forget its details. */
export async function webClose(connId: string): Promise<void> {
  const entry = entries.get(connId);
  entries.delete(connId);
  try {
    await raw(
      "POST",
      `/v1/c/${encodeURIComponent(entry?.handle ?? connId)}/close`,
      undefined,
    );
  } catch {
    // the server going away is the same as closed
  }
}

/** Free a connection's pool as the page unloads. Fire and forget: a page that
 *  is going away cannot wait for the answer, so the request is `keepalive`. */
export function webRelease(connId: string): void {
  const entry = entries.get(connId);
  const key = currentKey();
  try {
    void fetch(`/v1/c/${encodeURIComponent(entry?.handle ?? connId)}/close`, {
      method: "POST",
      keepalive: true,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
  } catch {
    // best effort on unload
  }
}

/** Reconnect one entry, sharing a single attempt between simultaneous calls. */
function reconnect(entry: Entry): Promise<void> {
  entry.reconnecting ??= openHandle(entry.details)
    .then((handle) => {
      entry.handle = handle;
    })
    .finally(() => {
      entry.reconnecting = null;
    });
  return entry.reconnecting;
}

async function isUnknownHandle(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const body = (await res.clone().json()) as { error?: string };
    return body.error === "unknown_handle";
  } catch {
    return false;
  }
}

function rejectKey(): void {
  clearWebKey();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(KEY_REJECTED_EVENT));
  }
}

/** Send one request. A data path has the current handle swapped in, and on
 *  `404 unknown_handle` the connection is reopened once and the call repeated
 *  once. A second 404 comes back as the error it is. */
async function send(
  method: Method,
  path: string,
  body: unknown,
): Promise<Response> {
  const m = DATA_PATH.exec(path);
  const entry = m ? entries.get(decodeURIComponent(m[1])) : undefined;
  const go = () =>
    m && entry
      ? raw(
          method,
          `/v1/c/${encodeURIComponent(entry.handle)}${m[2] ?? ""}`,
          body,
        )
      : raw(method, path, body);
  let res = await go();
  if (entry && (await isUnknownHandle(res))) {
    await (entry.reconnecting ?? reconnect(entry));
    res = await go();
  }
  if (res.status === 401) rejectKey();
  return res;
}

/** Fetch JSON from the server that served this page. */
export async function wcall<T>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await send(method, path, body);
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as T;
}

/** POST to a streaming route and hand each chunk to `onChunk` as it arrives.
 *  Resolves with the `done` line's result. A refusal or an error before the
 *  first byte comes back as the normal status and text, so it throws like
 *  `wcall`; an `error` line throws its message. A body that ends with neither
 *  line (the server went away, the network dropped) throws, never resolves as
 *  a finished result: the rows already handed over stay with the caller. */
export async function wstream<T>(
  path: string,
  body: unknown,
  onChunk: (chunk: Extract<StreamEvent, { t: "chunk" }>) => void,
): Promise<T> {
  const res = await send("POST", path, body);
  if (!res.ok) throw new Error(await errorText(res));
  if (!res.body) throw new Error("This browser cannot read a streamed answer.");
  let rows = 0;
  const end: { result?: T; error?: string; closed: boolean } = {
    closed: false,
  };
  try {
    await readNdjson(res.body, (event) => {
      if (event.t === "chunk") {
        rows += event.rows.length;
        onChunk(event);
      } else if (event.t === "done") {
        end.result = event.result as T;
        end.closed = true;
      } else {
        end.error = event.message;
        end.closed = true;
      }
    });
  } catch {
    // A cut connection: reported below like a body that just ended.
  }
  if (end.error !== undefined) throw new Error(end.error);
  if (!end.closed) {
    throw new Error(
      `The connection dropped after ${rows.toLocaleString()} rows.`,
    );
  }
  return end.result as T;
}

export async function wcallEmpty(
  method: Method,
  path: string,
  body?: unknown,
): Promise<void> {
  const res = await send(method, path, body);
  if (!res.ok) throw new Error(await errorText(res));
}

function errorFrom(res: Response, text: string): string {
  if (text) return `${res.status} — ${text}`;
  const url = res.url || "(unknown url)";
  switch (res.status) {
    case 403:
      return `${res.status} ${url} — refused. If you reach this server by a name other than localhost, set DH_PUBLIC_URL on it.`;
    case 401:
      return `${res.status} ${url} — the access key was refused.`;
    default:
      return `HTTP ${res.status} ${url}`;
  }
}

async function errorText(res: Response): Promise<string> {
  let text = "";
  try {
    text = (await res.text()).trim();
  } catch {
    // fall through to status-based hints
  }
  return errorFrom(res, text);
}

/** Forget every open connection (tests). */
export function resetWebConnections(): void {
  entries.clear();
}

export type { QueryResult };
