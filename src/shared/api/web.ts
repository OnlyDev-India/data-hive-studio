/**
 * Browser-build transport for the hosted Web UI.
 *
 * In web mode there is no Tauri IPC: every call goes to the deployed
 * dh-server over REST using an OAuth session token (`dhs_…`), obtained via
 * a full-page redirect through `/auth/{provider}/start` — see
 * `webOAuthStartUrl` and `src/web/WebGate.tsx`, which catches the callback
 * (`?token=…` on this same page) since there's no Tauri loopback listener
 * to do it out of process. The server holds all connection credentials, so
 * the browser never sees secrets.
 *
 * Multiple servers/orgs are supported: each saved profile has its own URL,
 * org id, and session token, stored under the `dh.web.servers` key as a
 * Record<profileId, config>. A user can be signed in to the same server
 * under several orgs at once — each is its own profile.
 *
 * The default server URL is fixed at build/deploy time:
 *   - production: the app is served BY the dh-server, so requests are
 *     same-origin relative (`VITE_SERVER_URL` unset → '').
 *   - custom deployments / local dev: set VITE_SERVER_URL (dev can also just
 *     rely on vite's `/v1` proxy → http://localhost:8080).
 */
import type { QueryResult } from "./types";

export const WEB = !(
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
);

// ---------------------------------------------------------------------------
//  Server registry — persisted in localStorage
// ---------------------------------------------------------------------------

export interface WebServerConfig {
  id: string;
  url: string;
  /** OAuth session token (`dhs_…`). */
  token: string;
  name: string;
  /** Which organization on that server this profile targets. */
  org_id: string;
}

const SERVERS_KEY = "dh.web.servers";

function readServers(): Record<string, WebServerConfig> {
  let servers: Record<string, WebServerConfig>;
  try {
    servers = JSON.parse(localStorage.getItem(SERVERS_KEY) ?? "{}") as Record<
      string,
      WebServerConfig
    >;
  } catch {
    return {};
  }
  return repairBrokenIds(servers);
}

/** One-time self-heal for entries an older build could save with a broken
 *  id — e.g. a blank same-origin URL slugified to "", so the entry got
 *  stored under key "" and silently overwrote/collided with anything else
 *  keyed the same way. Only touches entries that are actually broken (empty
 *  or inconsistent with their own map key); well-formed entries are left
 *  exactly as they are, so this never reshuffles a working profile's id. */
function repairBrokenIds(
  servers: Record<string, WebServerConfig>,
): Record<string, WebServerConfig> {
  let changed = false;
  const fixed: Record<string, WebServerConfig> = {};
  for (const [key, cfg] of Object.entries(servers)) {
    if (key !== "" && cfg.id === key) {
      fixed[key] = cfg;
      continue;
    }
    changed = true;
    const id = deriveServerId(cfg.url, cfg.org_id);
    fixed[id] = { ...cfg, id };
  }
  if (changed) {
    try {
      localStorage.setItem(SERVERS_KEY, JSON.stringify(fixed));
    } catch {
      // storage unavailable — repaired map still returned for this session
    }
  }
  return fixed;
}

function writeServers(servers: Record<string, WebServerConfig>): void {
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
}

/** List all stored server configs. */
export function webListServers(): WebServerConfig[] {
  return Object.values(readServers());
}

/** Look up one server by profile id. */
export function webServerConfig(
  profileId: string,
): WebServerConfig | undefined {
  return readServers()[profileId];
}

/** Persist a server config (post-OAuth, org chosen). */
export function webAddServer(config: WebServerConfig): void {
  const servers = readServers();
  // Normalize: a trailing slash here makes later `${base}/v1/...` requests
  // double-slash (http://host//v1/...) which 404s/405s at the server.
  const url = config.url.replace(/\/+$/, "");
  servers[config.id] = { ...config, url };
  writeServers(servers);
}

/** Remove a server config. */
export function webRemoveServer(profileId: string): void {
  const servers = readServers();
  delete servers[profileId];
  writeServers(servers);
}

// ---------------------------------------------------------------------------
//  Default server URL (build-time or same-origin)
// ---------------------------------------------------------------------------

export function apiUrl(): string {
  return (
    (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(
      /\/+$/,
      "",
    ) ?? ""
  );
}

export function slugifyUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 40);
}

/** Derive a stable, non-empty profile id for a server config. URL-derived
 *  (or "same_origin" for the default same-origin blank URL), disambiguated
 *  by org id so several orgs signed in to the SAME origin get distinct ids
 *  instead of colliding into one storage slot. Deterministic per
 *  (url, org_id) so re-connecting overwrites the existing entry rather than
 *  duplicating it. */
export function deriveServerId(url: string, org_id: string): string {
  const base = slugifyUrl(url) || "same_origin";
  return `${base}__${org_id}`;
}

// ---------------------------------------------------------------------------
//  OAuth sign-in (web build — full-page redirect, no loopback listener)
// ---------------------------------------------------------------------------

function normalizeBase(url: string): string {
  const t = url.trim().replace(/\/+$/, "");
  if (!t) return t;
  return t.startsWith("http") ? t : `https://${t}`;
}

/** URL to send the browser to for `provider`'s OAuth consent screen. The
 *  server redirects back to `next` with the session token appended as a
 *  `token=` query param once sign-in completes (see `router.rs::auth_callback`). */
export function webOAuthStartUrl(
  base: string,
  provider: string,
  next: string,
): string {
  const b = normalizeBase(base);
  return `${b}/auth/${provider}/start?next=${encodeURIComponent(next)}`;
}

// ---------------------------------------------------------------------------
//  Authenticated fetch — supports per-server URL + token
// ---------------------------------------------------------------------------

/** Authenticated fetch against a dh-server. Defaults to the primary server. */
export async function wcall<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  serverUrl?: string,
  token?: string,
): Promise<T> {
  const base = serverUrl ?? apiUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as T;
}

export async function wcallEmpty(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  serverUrl?: string,
  token?: string,
): Promise<void> {
  const base = serverUrl ?? apiUrl();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await errorText(res));
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.text()).trim();
    if (body) return `${res.status} — ${body}`;
  } catch {
    // fall through to status-based hints
  }
  const url = res.url || "(unknown url)";
  switch (res.status) {
    case 405:
      return `${res.status} ${url} — method not allowed. The SERVER binary is older than this UI: rebuild/restart the server container so its routes match.`;
    case 404:
      return `${res.status} ${url} — endpoint missing on the server (same cause as 405: server binary predates this UI).`;
    case 401:
      return `${res.status} ${url} — session invalid/expired. Sign in again.`;
    default:
      return `HTTP ${res.status} ${url}`;
  }
}

export type { QueryResult };
