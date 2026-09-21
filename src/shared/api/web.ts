/**
 * Browser-build transport for the hosted Web UI.
 *
 * In web mode there is no Tauri IPC: every call goes to the dh-server that
 * serves this page, over REST, with a short lived access token (`dha_…`) kept
 * in page memory (`web-session.ts`). Signing in is a full-page redirect through
 * `/auth/{provider}/start` that comes back with a one time `?code=`, which
 * `src/web/WebGate.tsx` trades for a session, since there's no Tauri loopback
 * listener to do it out of process. The renewal token is an HttpOnly cookie
 * the page cannot read. The server holds all connection credentials, so the
 * browser never sees secrets.
 *
 * The web page is same origin only: requests always go to the server that
 * served it (or, in development, through vite's `/v1` and `/auth` proxy).
 *
 * Multiple orgs are supported: each saved profile has its own org id, stored
 * under the `dh.web.servers` key as a Record<profileId, config>. There is one
 * session for the origin, shared by every profile, and no token is stored.
 */
import type { QueryResult } from "./types";
import { webAccessToken, webRenew } from "./web-session";

export const WEB = !(
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
);

// ---------------------------------------------------------------------------
//  Server registry — persisted in localStorage
// ---------------------------------------------------------------------------

export interface WebServerConfig {
  id: string;
  url: string;
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

/** Older builds saved a session token next to each profile. Those tokens no
 *  longer work, and a token at rest is only a liability, so delete the field.
 *  Runs when this module loads in the browser (see the bottom of the file). */
export function scrubLegacyTokens(): void {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    if (!raw) return;
    const servers = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    let changed = false;
    for (const cfg of Object.values(servers)) {
      if (cfg && typeof cfg === "object" && "token" in cfg) {
        delete cfg.token;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  } catch {
    // storage unavailable or unreadable: nothing to scrub
  }
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
//  The server: always the origin that served this page
// ---------------------------------------------------------------------------

/** The web page talks only to the server that served it, so this is always
 *  the empty (same origin) base. It used to follow `VITE_SERVER_URL`; a page
 *  can no longer be pointed at another origin (spec 0010, AC-17). */
export function apiUrl(): string {
  return "";
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

/** URL to send the browser to for `provider`'s OAuth consent screen. The
 *  server redirects back to `next` (a path on this origin) with a one time
 *  `code=` query param once sign-in completes (see `router/auth.rs`).
 *  `challenge` is the PKCE hash of a secret this page keeps in
 *  `sessionStorage`, so the code is useless to anyone who only sees the
 *  address. */
export function webOAuthStartUrl(
  provider: string,
  next: string,
  challenge: string,
): string {
  return `/auth/${provider}/start?next=${encodeURIComponent(next)}&code_challenge=${encodeURIComponent(challenge)}`;
}

// ---------------------------------------------------------------------------
//  Fetch — sends the session's access token, renews it, retries once
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "DELETE";

/** Send one request. With `authed`, the call carries the access token
 *  (renewed first when it is about to expire), and a 401 renews once and
 *  retries once, so a token the server ended early is picked up without the
 *  person noticing. Without it (`/auth/providers`) nothing is attached. */
async function send(
  method: Method,
  path: string,
  body: unknown,
  authed: boolean,
): Promise<Response> {
  const go = (token?: string) =>
    fetch(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  if (!authed) return go();
  const token = await webAccessToken();
  const res = await go(token);
  if (res.status !== 401) return res;
  return go(await webRenew(token));
}

/** Fetch JSON from the server that served this page. */
export async function wcall<T>(
  method: Method,
  path: string,
  body?: unknown,
  authed = false,
): Promise<T> {
  const res = await send(method, path, body, authed);
  if (!res.ok) throw new Error(await errorText(res));
  return (await res.json()) as T;
}

export async function wcallEmpty(
  method: Method,
  path: string,
  body?: unknown,
  authed = false,
): Promise<void> {
  const res = await send(method, path, body, authed);
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
      return `${res.status} ${url} — signed out. Sign in again.`;
    default:
      return `HTTP ${res.status} ${url}`;
  }
}

export type { QueryResult };

if (WEB && typeof localStorage !== "undefined") scrubLegacyTokens();
