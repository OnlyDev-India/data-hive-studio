import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall } from "./web";
import { withReadOnlyHint } from "./read-only";

/** Operations that only the desktop app can do (they need a local file or the
 *  native backend). Throws in the web build. */
export function serverUnsupported(): void {
  if (WEB) {
    throw new Error("This operation requires the desktop app.");
  }
}

/**
 * Shared web/desktop dispatch for the connection-scoped read/query functions
 * in `connection.ts` and `query.ts`. Each of those functions would otherwise
 * repeat the same two branches (the web build over HTTP to the server, the
 * desktop over a Tauri command); this collapses it to one call, differing only
 * in which HTTP path/method to hit and which Tauri command and args to use.
 * On the web the connection id is the server handle, and `wcall` swaps in the
 * live one if the connection had to be reopened.
 */
export function dispatchDbCall<T>(
  connId: string,
  opts: {
    httpMethod: "GET" | "POST" | "PUT";
    httpPath: (connId: string) => string;
    httpBody?: unknown;
    localCmd: string;
    args: Record<string, unknown>;
  },
): Promise<T> {
  return hinted(dispatchRaw<T>(connId, opts));
}

/** Add the where-to-turn-it-off hint to a read only refusal (spec 0007): the
 *  backend's text says what was refused but not where to turn it off. Every
 *  other failure passes through untouched. Wrap any write call that does not
 *  go through {@link dispatchDbCall}. */
export function hinted<T>(call: Promise<T>): Promise<T> {
  return call.catch((e: unknown) => {
    throw withReadOnlyHint(e);
  });
}

function dispatchRaw<T>(
  connId: string,
  opts: Parameters<typeof dispatchDbCall>[1],
): Promise<T> {
  if (WEB) return wcall<T>(opts.httpMethod, opts.httpPath(connId), opts.httpBody);
  return invoke<T>(opts.localCmd, opts.args);
}

/**
 * Collapse near-simultaneous identical READ calls into ONE IPC round trip.
 *
 * Two sources of phantom duplicate commands:
 * 1. React StrictMode mounts→unmounts→remounts components in dev — effects
 *    fire twice, sometimes AFTER the first call already resolved on a fast
 *    local database.
 * 2. Several components (sidebar, panes, SQL console) request the same
 *    table's schema on mount.
 *
 * Entries live for a few hundred milliseconds — long enough to swallow
 * StrictMode/multi-component bursts, far shorter than a human-triggered
 * refetch (e.g. after applying DDL), so results never feel stale. Only wrap
 * idempotent introspection reads — NEVER writes or data queries.
 */
const CACHE_TTL_MS = 300;
const inflight = new Map<string, { p: Promise<unknown>; at: number }>();
export function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    if (import.meta.env.DEV) {
      console.debug(`[dedupe] HIT  ${key}`);
    }
    return hit.p as Promise<T>;
  }
  if (import.meta.env.DEV) {
    console.debug(
      `[dedupe] MISS ${key}`,
      hit ? `(entry expired, age ${now - hit.at}ms)` : "(no entry)",
      new Error("caller").stack?.split("\n")[2]?.trim(),
    );
  }
  const p = run().finally(() => {
    // Keep serving the cached result for the TTL window, then drop it so
    // later refreshes (revision bumps, DDL applies) always hit the backend.
    setTimeout(() => {
      const cur = inflight.get(key);
      if (cur?.p === p) inflight.delete(key);
    }, CACHE_TTL_MS);
  });
  inflight.set(key, { p, at: now });
  return p;
}
