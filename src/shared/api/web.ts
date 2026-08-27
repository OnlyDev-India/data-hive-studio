/**
 * Browser-build transport for the hosted Web UI.
 *
 * In web mode there is no Tauri IPC: every call goes to the deployed
 * dh-server(s) over REST using device tokens. Tokens are enrolled once (via
 * admin invite codes) and kept in localStorage — the server holds all
 * connection credentials, so the browser never sees secrets.
 *
 * Multiple servers are supported: each server has its own URL and token,
 * stored under the `dh.web.servers` key as a Record<profileId, config>.
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
  token: string;
  name: string;
  /** Required for tem_ tokens — sent as X-Team on every request. */
  team_name?: string;
}

const SERVERS_KEY = "dh.web.servers";
const LEGACY_TOKEN_KEY = "dh.web.token";

function readServers(): Record<string, WebServerConfig> {
  try {
    return JSON.parse(localStorage.getItem(SERVERS_KEY) ?? "{}") as Record<
      string,
      WebServerConfig
    >;
  } catch {
    return {};
  }
}

/** Look up the team name for a given server URL from stored configs. */
function teamNameFor(url: string): string | undefined {
  const base = url.replace(/\/+$/, "");
  for (const cfg of Object.values(readServers())) {
    if (cfg.url === base || cfg.url.replace(/\/+$/, "") === base)
      return cfg.team_name;
  }
  return undefined;
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

/** Persist a server config (enroll result or query-param bootstrap). */
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

// ---------------------------------------------------------------------------
//  Legacy single-token helpers (backward compat — now backed by servers map)
// ---------------------------------------------------------------------------

export function webToken(): string {
  // Primary: first server in the registry, or legacy key.
  const servers = webListServers();
  if (servers.length > 0) return servers[0].token;
  return localStorage.getItem(LEGACY_TOKEN_KEY) ?? "";
}

export function setWebToken(token: string): void {
  localStorage.setItem(LEGACY_TOKEN_KEY, token);
}

export function hasWebToken(): boolean {
  return webToken().length > 0 || webListServers().length > 0;
}

// ---------------------------------------------------------------------------
//  Enrollment
// ---------------------------------------------------------------------------

/** Verify a bearer token against the server and return the config. No
 *  enrollment step — the caller provides the token directly (adm_ or tem_)
 *  plus an optional team name for tem_ tokens. */
export async function webVerify(
  token: string,
  user_name: string,
  team_name?: string,
  serverUrl?: string,
): Promise<WebServerConfig> {
  const base = (serverUrl ?? apiUrl()).replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(team_name ? { "X-Team": team_name } : {}),
  };
  const res = await fetch(`${base}/v1/me`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `HTTP ${res.status}`);
  }
  // Derive a stable profile id from the URL.
  const id = slugifyUrl(base);
  const config: WebServerConfig = {
    id,
    url: base,
    token,
    name: user_name || "Team server",
    team_name,
  };
  webAddServer(config);
  return config;
}

export function slugifyUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 40);
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
  const auth = token ?? webToken();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      ...(teamNameFor(serverUrl ?? apiUrl())
        ? { "X-Team": teamNameFor(serverUrl ?? apiUrl()) }
        : {}),
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
  const auth = token ?? webToken();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${auth}`,
      ...(teamNameFor(serverUrl ?? apiUrl())
        ? { "X-Team": teamNameFor(serverUrl ?? apiUrl()) }
        : {}),
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
      return `${res.status} ${url} — token invalid/expired. Re-enroll this server with a fresh invite code.`;
    default:
      return `HTTP ${res.status} ${url}`;
  }
}

export type { QueryResult };
