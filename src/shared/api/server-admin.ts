import { invoke } from "@tauri-apps/api/core";
import {
  WEB,
  wcall,
  wcallEmpty,
  apiUrl,
  hasWebToken,
  webServerConfig,
  webListServers,
  webAddServer,
  webRemoveServer,
  type WebServerConfig,
} from "./web";
import { remoteOf, webAuthFor } from "./dispatch";

export interface ServerProfileView {
  id: string;
  name: string;
  url: string;
  connected: boolean;
}

export interface ServerMe {
  device_id: string;
  is_admin: boolean;
}

export interface ServerSession {
  profile: { id: string; name: string; url: string };
  me: ServerMe;
  /** Granted connections as seen by the server (remote ids, no prefix),
   *  including THIS device's effective access level. */
  connections: {
    id: string;
    name: string;
    kind?: "postgres" | "mongodb";
    host: string;
    port: number;
    user: string;
    database: string;
    ssl_mode?: string | null;
    /** MongoDB only. */
    auth_db?: string;
    srv?: boolean;
    tls?: boolean;
    created_by: string;
    created_ms: number;
    updated_ms: number;
    data_access: "readonly" | "readwrite";
    can_edit: boolean;
    can_delete: boolean;
  }[];
}

/** Synthetic profile id used by the browser build (single server, same origin). */
export const WEB_PROFILE_ID = "web";

export function serversList(): Promise<ServerProfileView[]> {
  if (WEB) {
    const servers = webListServers();
    // Legacy: single server enrolled under the old key.
    if (servers.length === 0 && hasWebToken()) {
      servers.push({
        id: WEB_PROFILE_ID,
        url: apiUrl() || "(same origin)",
        token: "",
        name: "Team server",
      });
    }
    return Promise.all(
      servers.map(async (s) => {
        try {
          await wcall<ServerMe>(
            "GET",
            "/v1/me",
            undefined,
            s.url,
            s.token || undefined,
          );
          return { id: s.id, name: s.name, url: s.url, connected: true };
        } catch {
          return { id: s.id, name: s.name, url: s.url, connected: false };
        }
      }),
    );
  }
  return invoke("servers_list");
}

export function serversAdd(
  name: string,
  url: string,
  token: string,
  team_name?: string,
): Promise<ServerProfileView> {
  if (WEB) {
    const id = url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 40);
    const cfg: WebServerConfig = {
      id,
      url: url.replace(/\/+$/, ""),
      token,
      name,
      ...(team_name ? { team_name } : {}),
    };
    webAddServer(cfg);
    return Promise.resolve({ id, name, url: cfg.url, connected: true });
  }
  return invoke("servers_add", { name, url, token, teamName: team_name });
}

export function serversRemove(profileId: string): Promise<void> {
  if (WEB) {
    webRemoveServer(profileId);
    return Promise.resolve();
  }
  return invoke("servers_remove", { profileId });
}

export function serversConnect(profileId: string): Promise<ServerSession> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return Promise.all([
      wcall<ServerMe>("GET", "/v1/me", undefined, url, token || undefined),
      wcall<ServerSession["connections"]>(
        "GET",
        "/v1/connections",
        undefined,
        url,
        token || undefined,
      ),
    ])
      .catch((e: unknown) => {
        // Network-level failure (unreachable host, CORS block) — fetch throws a
        // bare TypeError with no context. Give the user the target URL + cause.
        const detail =
          e instanceof TypeError
            ? `cannot reach ${url || "(same origin)"} — check the URL/port, and that this server runs the CURRENT build (older builds lack CORS)`
            : String(e);
        throw new Error(
          `Connect failed for "${profileId.slice(0, 12)}": ${detail}`,
        );
      })
      .then(([me, connections]) => ({
        profile: {
          id: profileId,
          name: webServerConfig(profileId)?.name ?? "Team server",
          url: url || "(same origin)",
        },
        me,
        connections,
      }));
  }
  return invoke("servers_connect", { profileId });
}

export interface ServerConnInput {
  name: string;
  /** Immutable after creation; omitted (or "postgres") for existing PG saves. */
  kind?: "postgres" | "mongodb";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode?: string | null;
  /** MongoDB only: auth source database (defaults to "admin" when omitted). */
  auth_db?: string;
  /** MongoDB only: use mongodb+srv:// (DNS seedlist) instead of mongodb://. */
  srv?: boolean;
  /** MongoDB only: require TLS on a plain mongodb:// connection. */
  tls?: boolean;
}

/** Publish a shared connection to a team server — admin scope only. */
export function serversCreateConnection(
  profileId: string,
  input: ServerConnInput,
): Promise<unknown> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<unknown>(
      "POST",
      "/v1/connections",
      input,
      url,
      token || undefined,
    );
  }
  return invoke("servers_create_connection", { profileId, input });
}

/** Update an existing shared connection's details (name, host, port, etc.). */
export function serversUpdateConnection(
  profileId: string,
  connId: string,
  input: ServerConnInput,
): Promise<unknown> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<unknown>(
      "PUT",
      `/v1/connections/${encodeURIComponent(remoteOf(connId))}`,
      input,
      url,
      token || undefined,
    );
  }
  return invoke("servers_update_connection", { profileId, connId, input });
}

/** Delete a shared connection. Allowed for admins and devices holding its
 *  `can_delete` grant. `connId` is the remote (server-side) id. */
export function serversDeleteConnection(
  profileId: string,
  connId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/connections/${encodeURIComponent(connId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_delete_connection", { profileId, connId });
}

/** Fetch decrypted connection credentials (host, port, user, password, database)
 *  from the server. Requires can_read grant or admin scope. */
export interface ServerCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode?: string | null;
  /** MongoDB only. */
  auth_db?: string;
  srv?: boolean;
  tls?: boolean;
}

export function serversFetchCredentials(
  profileId: string,
  connId: string,
): Promise<ServerCredentials> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<ServerCredentials>(
      "GET",
      `/v1/connections/${encodeURIComponent(remoteOf(connId))}/credentials`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_fetch_credentials", { profileId, connId });
}

export function serversDisconnect(profileId: string): Promise<void> {
  if (WEB) return Promise.resolve();
  return invoke("servers_disconnect", { profileId });
}

/** Release (close) a server-side connection pool. Web clients call this on
 *  page unload so the server frees resources immediately instead of waiting
 *  for the idle timeout. */
export function serversReleaseConnection(
  profileId: string,
  connId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "POST",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/close`,
      undefined,
      url,
      token || undefined,
    );
  }
  return Promise.resolve();
}

// ---- Admin helpers (web-aware) --------------------------------------------

export function serversAdminDevices<T = unknown[]>(
  profileId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      "/v1/admin/devices",
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke<T>("servers_admin_devices", { profileId });
}

/** Mint an adm_ (admin) or tem_ (team) bearer token directly. */
export function serversAdminMintToken(
  profileId: string,
  input: {
    kind: "admin" | "team";
    user_name: string;
    team_name?: string;
    grants: {
      conn_id: string;
      can_read: boolean;
      can_update: boolean;
      can_delete: boolean;
    }[];
  },
): Promise<{ token: string }> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall("POST", "/v1/admin/tokens", input, url, token || undefined);
  }
  return invoke<{ token: string }>("servers_admin_mint_token", {
    profileId,
    ...input,
  });
}

export function serversAdminTokensList<T = unknown[]>(
  profileId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall("GET", "/v1/admin/tokens", undefined, url, token || undefined);
  }
  return invoke("servers_admin_tokens_list", { profileId });
}

export function serversAdminDeleteToken(
  profileId: string,
  token: string,
): Promise<void> {
  if (WEB) {
    const { url, token: serverToken } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/admin/tokens/${encodeURIComponent(token)}`,
      undefined,
      url,
      serverToken || undefined,
    );
  }
  return invoke("servers_admin_delete_token", { profileId, token });
}

export function serversAdminConnections<T = unknown[]>(
  profileId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      "/v1/admin/connections",
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke<T>("servers_admin_connections", { profileId });
}

export function serversAdminRevokeDevice(
  profileId: string,
  deviceId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/admin/devices/${encodeURIComponent(deviceId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_revoke_device", { profileId, deviceId });
}

export function serversAdminGrants<T = unknown[]>(
  profileId: string,
  deviceId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      `/v1/admin/grants/${encodeURIComponent(deviceId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_grants", { profileId, deviceId });
}

export function serversAdminSetGrant(
  profileId: string,
  deviceId: string,
  connId: string,
  can_read: boolean,
  can_update: boolean,
  can_delete: boolean,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "PUT",
      `/v1/admin/grants/${encodeURIComponent(deviceId)}/${encodeURIComponent(connId)}`,
      { can_read, can_update, can_delete },
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_set_grant", {
    profileId,
    deviceId,
    connId,
    canRead: can_read,
    canUpdate: can_update,
    canDelete: can_delete,
  });
}

export function serversAdminRevokeGrant(
  profileId: string,
  deviceId: string,
  connId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/admin/grants/${encodeURIComponent(deviceId)}/${encodeURIComponent(connId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_revoke_grant", { profileId, deviceId, connId });
}
