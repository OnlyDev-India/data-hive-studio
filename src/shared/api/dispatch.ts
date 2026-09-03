import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall, webServerConfig, apiUrl } from "./web";

// ---- Server (team) connection id helpers -----------------------------------
//
// Server-backed connections use namespaced ids `srv:<profile_id>:<conn_id>`
// so every existing grid/console component keeps its call signatures; the
// client routes those calls to the gateway passthrough commands instead of
// the local backend registry.

/** Build a namespaced connection id for a connection served by a team server. */
export function srvConnId(profileId: string, remoteConnId: string): string {
  return `srv:${profileId}:${remoteConnId}`;
}

/** True when this id addresses a team-server connection rather than a local one. */
export function isServerConn(connId: string): boolean {
  if (!connId.startsWith("srv:")) return false;
  const parts = connId.split(":");
  return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0;
}

/** Remote (server-side) connection id from a namespaced one. */
export function remoteOf(connId: string): string {
  return connId.split(":")[2] ?? "";
}

/** Profile id embedded in a namespaced server connection id. */
export function profileOf(connId: string): string {
  return connId.split(":")[1] ?? "";
}

/** Resolve the { url, token } for a server profile — used by every WEB-mode
 *  function that needs per-server auth. Falls back to the primary server. */
export function webAuthFor(profileId: string): { url: string; token: string } {
  const cfg = webServerConfig(profileId);
  if (cfg) return { url: cfg.url.replace(/\/+$/, ""), token: cfg.token };
  // Legacy single-server fallback.
  return { url: apiUrl(), token: "" };
}

/** Team-server connections do not support local-only operations. */
export function serverUnsupported(connId: string): void {
  if (isServerConn(connId)) {
    throw new Error(
      "This operation is not available on team-server connections.",
    );
  }
  if (WEB) {
    throw new Error("This operation requires the desktop app.");
  }
}

/**
 * Shared WEB/Tauri/server-passthrough dispatch for the connection-scoped
 * read/query functions in `connection.ts` and `query.ts`. Each of those
 * functions previously repeated this exact 4-branch shape (web+server-conn
 * via HTTP with per-server auth, web via HTTP same-origin, desktop
 * server-conn via a `server_*` Tauri passthrough command, desktop local via
 * the plain Tauri command) — this collapses it to one call, differing only
 * in which HTTP path/method to hit and which Tauri commands/args to use.
 */
export function dispatchDbCall<T>(
  connId: string,
  opts: {
    httpMethod: "GET" | "POST";
    httpPath: (remoteId: string) => string;
    httpBody?: unknown;
    serverCmd: string;
    localCmd: string;
    args: Record<string, unknown>;
  },
): Promise<T> {
  if (WEB && isServerConn(connId)) {
    const { url, token } = webAuthFor(profileOf(connId));
    return wcall<T>(
      opts.httpMethod,
      opts.httpPath(remoteOf(connId)),
      opts.httpBody,
      url,
      token || undefined,
    );
  }
  if (WEB) return wcall<T>(opts.httpMethod, opts.httpPath(remoteOf(connId)), opts.httpBody);
  if (isServerConn(connId)) return invoke<T>(opts.serverCmd, opts.args);
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
