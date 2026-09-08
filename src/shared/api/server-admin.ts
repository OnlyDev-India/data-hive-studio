import { invoke } from "@tauri-apps/api/core";
import {
  WEB,
  wcall,
  wcallEmpty,
  apiUrl,
  webListServers,
  webServerConfig,
  webRemoveServer,
} from "./web";
import { remoteOf, webAuthFor } from "./dispatch";

export type OrgRole = "viewer" | "member" | "admin" | "owner";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_ms: number;
}

export interface MeOrg extends Organization {
  role: OrgRole;
}

export interface MeResult {
  user_id: string;
  email: string;
  name: string;
  orgs: MeOrg[];
}

/** Whether `me` can manage membership (invite/remove/change roles) in
 *  `orgId` — mirrors `OrgRole::can_manage_members` server-side (owner/admin
 *  only). */
export function canManageOrg(me: MeResult, orgId: string): boolean {
  const role = me.orgs.find((o) => o.id === orgId)?.role;
  return role === "owner" || role === "admin";
}

/** Whether `me` can publish a new shared connection in `orgId` — mirrors
 *  `gateway.rs::create_connection`'s requirement of at least `Member`
 *  (Viewer cannot). */
export function canPublishConnections(me: MeResult, orgId: string): boolean {
  const role = me.orgs.find((o) => o.id === orgId)?.role;
  return role === "owner" || role === "admin" || role === "member";
}

export interface ServerProfileView {
  id: string;
  name: string;
  url: string;
  org_id: string;
  connected: boolean;
}

export interface ServerConn {
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
  ssl_ca_file?: string | null;
  ssl_client_cert_file?: string | null;
  /** PostgreSQL only. */
  ssl_client_key_file?: string | null;
  /** `ssh_host` set means this connection tunnels through SSH — no
   *  secrets here, this is metadata only (`ConnMeta`, never `ConnInput`). */
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_mode?: string | null;
  ssh_key_file?: string | null;
  ssh_host_key_fingerprint?: string | null;
  created_by: string;
  created_ms: number;
  updated_ms: number;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface ServerSession {
  profile: { id: string; name: string; url: string; org_id: string };
  me: MeResult;
  connections: ServerConn[];
}

// ---- OAuth sign-in + profile persistence -----------------------------------
//
// Desktop opens the system browser and catches the callback on a local
// loopback listener (`servers_oauth_login` in src-tauri/src/servers.rs); web
// just redirects the whole page (`webOAuthStartUrl`, handled in WebGate on
// the way back in). Either way this module never sees a password — only the
// resulting session token.

/** Which OAuth providers `url` has credentials configured for — lets the
 *  sign-in form show only the buttons that will actually work. */
export function serversOAuthProviders(url: string): Promise<string[]> {
  if (WEB) {
    return wcall<string[]>("GET", "/auth/providers", undefined, url || apiUrl());
  }
  return invoke("servers_oauth_providers", { url });
}

/** Desktop only: run a full OAuth round trip and return the session token +
 *  identity/org list. Does not persist anything. */
export function serversOAuthLogin(
  url: string,
  provider: string,
): Promise<{ token: string; me: MeResult }> {
  return invoke("servers_oauth_login", { url, provider });
}

/** Look for a still-usable session this app already holds for `url` — any
 *  previously saved profile pointed at the same server, since a session
 *  token isn't org-scoped (any org's token works for every org on that
 *  server). Lets "add another org on a server I've already signed in to"
 *  skip a fresh OAuth round trip. Never throws — `null` means "nothing
 *  usable, fall back to a normal sign-in". */
export async function serversReuseSession(
  url: string,
): Promise<{ token: string; me: MeResult } | null> {
  if (WEB) {
    const target = (url || apiUrl()).replace(/\/+$/, "");
    for (const cfg of webListServers()) {
      if (cfg.url !== target) continue;
      try {
        const me = await wcall<MeResult>("GET", "/v1/me", undefined, cfg.url, cfg.token);
        return { token: cfg.token, me };
      } catch {
        // stale/expired session — try the next matching profile, if any
      }
    }
    return null;
  }
  return invoke("servers_reuse_session", { url });
}

/** Create a brand-new organization using a not-yet-saved OAuth session. */
export function serversOrgCreateNew(
  url: string,
  token: string,
  name: string,
): Promise<Organization> {
  if (WEB) {
    return wcall<Organization>(
      "POST",
      "/v1/orgs",
      { name },
      url || apiUrl(),
      token,
    );
  }
  return invoke("servers_org_create_new", { url, token, name });
}

/** Redeem a shareable invite code using a not-yet-saved OAuth session. */
export function serversOrgRedeemInviteNew(
  url: string,
  token: string,
  code: string,
): Promise<Organization> {
  if (WEB) {
    return wcall<Organization>(
      "POST",
      `/v1/invites/${encodeURIComponent(code)}/redeem`,
      undefined,
      url || apiUrl(),
      token,
    );
  }
  return invoke("servers_org_redeem_invite_new", { url, token, code });
}

/** Desktop only: persist a profile (keychain token + servers.json) for a
 *  server the user has OAuth-signed-in to and chosen an org on. Web instead
 *  calls `webAddServer` directly (see `connect-server-dialog.tsx`) — there's
 *  no Tauri process to hold a keychain entry for it. */
export function serversSaveProfile(
  name: string,
  url: string,
  token: string,
  org_id: string,
): Promise<{ id: string; name: string; url: string; org_id: string }> {
  return invoke("servers_save_profile", { name, url, token, orgId: org_id });
}

export function serversList(): Promise<ServerProfileView[]> {
  if (WEB) {
    return Promise.all(
      webListServers().map(async (s) => {
        try {
          await wcall<MeResult>(
            "GET",
            "/v1/me",
            undefined,
            s.url,
            s.token || undefined,
          );
          return {
            id: s.id,
            name: s.name,
            url: s.url,
            org_id: s.org_id,
            connected: true,
          };
        } catch {
          return {
            id: s.id,
            name: s.name,
            url: s.url,
            org_id: s.org_id,
            connected: false,
          };
        }
      }),
    );
  }
  return invoke("servers_list");
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
    const cfg = webServerConfig(profileId);
    if (!cfg) return Promise.reject(new Error("server profile not found"));
    return Promise.all([
      wcall<MeResult>(
        "GET",
        "/v1/me",
        undefined,
        cfg.url,
        cfg.token || undefined,
      ),
      wcall<ServerConn[]>(
        "GET",
        `/v1/orgs/${encodeURIComponent(cfg.org_id)}/connections`,
        undefined,
        cfg.url,
        cfg.token || undefined,
      ),
    ])
      .catch((e: unknown) => {
        // Network-level failure (unreachable host, CORS block) — fetch throws a
        // bare TypeError with no context. Give the user the target URL + cause.
        const detail =
          e instanceof TypeError
            ? `cannot reach ${cfg.url || "(same origin)"} — check the URL/port, and that this server runs the CURRENT build (older builds lack CORS)`
            : String(e);
        throw new Error(
          `Connect failed for "${profileId.slice(0, 12)}": ${detail}`,
        );
      })
      .then(([me, connections]) => ({
        profile: {
          id: profileId,
          name: cfg.name,
          url: cfg.url || "(same origin)",
          org_id: cfg.org_id,
        },
        me,
        connections,
      }));
  }
  return invoke("servers_connect", { profileId });
}

export function serversDisconnect(profileId: string): Promise<void> {
  if (WEB) return Promise.resolve();
  return invoke("servers_disconnect", { profileId });
}

// ---- Connections (org-scoped) ------------------------------------------------

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
  /** Path to a CA certificate file verifying the server's certificate. */
  ssl_ca_file?: string | null;
  /** Path to a client certificate for mutual TLS (mTLS). PostgreSQL: paired
   *  with `ssl_client_key_file`. MongoDB: a single PEM with both the
   *  certificate and its (unencrypted) private key. */
  ssl_client_cert_file?: string | null;
  /** PostgreSQL only: path to the client certificate's private key file. */
  ssl_client_key_file?: string | null;
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  /** "password" | "key". */
  ssh_auth_mode?: string | null;
  ssh_key_file?: string | null;
  ssh_host_key_fingerprint?: string | null;
  /** `undefined`/omitted on update keeps the existing stored SSH password. */
  ssh_password?: string | null;
  /** Same "omitted keeps the existing one" rule as `ssh_password`. */
  ssh_key_passphrase?: string | null;
}

/** Publish a new shared connection in the profile's org. Requires at least
 *  Member there — enforced server-side. */
export function serversCreateConnection(
  profileId: string,
  orgId: string,
  input: ServerConnInput,
): Promise<unknown> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<unknown>(
      "POST",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections`,
      input,
      url,
      token || undefined,
    );
  }
  return invoke("servers_create_connection", { profileId, orgId, input });
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

/** Delete a shared connection. Allowed for org admins/owners and members
 *  holding an explicit `can_delete` grant override. `connId` is the remote
 *  (server-side) id. */
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
 *  from the server. Requires read access. */
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

// ---- Organizations: membership + invites -----------------------------------

export interface OrgMember {
  user_id: string;
  email: string;
  name: string;
  role: OrgRole;
  joined_ms: number;
}

export interface OrgInvite {
  code: string;
  org_id: string;
  role: OrgRole;
  created_by: string;
  max_uses: number | null;
  uses_count: number;
  expires_ms: number | null;
  created_ms: number;
}

export interface AuditEntry {
  ts_ms: number;
  org_id: string | null;
  user_id: string | null;
  action: string;
  target: string;
  detail: string | null;
}

export function serversOrgMembers(
  profileId: string,
  orgId: string,
): Promise<OrgMember[]> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_members", { profileId, orgId });
}

export function serversOrgSetMemberRole(
  profileId: string,
  orgId: string,
  userId: string,
  role: OrgRole,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "PUT",
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { role },
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_set_member_role", {
    profileId,
    orgId,
    userId,
    role,
  });
}

export function serversOrgRemoveMember(
  profileId: string,
  orgId: string,
  userId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_remove_member", { profileId, orgId, userId });
}

export function serversOrgInvitesList(
  profileId: string,
  orgId: string,
): Promise<OrgInvite[]> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/invites`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_invites_list", { profileId, orgId });
}

export function serversOrgInviteCreate(
  profileId: string,
  orgId: string,
  role: OrgRole,
  maxUses: number | null,
  expiresMs: number | null,
): Promise<OrgInvite> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "POST",
      `/v1/orgs/${encodeURIComponent(orgId)}/invites`,
      { role, max_uses: maxUses, expires_ms: expiresMs },
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_invite_create", {
    profileId,
    orgId,
    role,
    maxUses,
    expiresMs,
  });
}

export function serversOrgInviteRevoke(
  profileId: string,
  orgId: string,
  code: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/invites/${encodeURIComponent(code)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_invite_revoke", { profileId, orgId, code });
}

export function serversOrgAudit(
  profileId: string,
  orgId: string,
  limit = 100,
): Promise<AuditEntry[]> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/audit?limit=${limit}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_org_audit", { profileId, orgId, limit });
}

// ---- Per-connection grant overrides --------------------------------------

export interface Grant {
  conn_id: string;
  user_id: string;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export function serversGrantsList(
  profileId: string,
  orgId: string,
  connId: string,
): Promise<Grant[]> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections/${encodeURIComponent(connId)}/grants`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_grants_list", { profileId, orgId, connId });
}

export function serversGrantSet(
  profileId: string,
  orgId: string,
  connId: string,
  userId: string,
  can_read: boolean,
  can_update: boolean,
  can_delete: boolean,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "PUT",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections/${encodeURIComponent(connId)}/grants/${encodeURIComponent(userId)}`,
      { can_read, can_update, can_delete },
      url,
      token || undefined,
    );
  }
  return invoke("servers_grant_set", {
    profileId,
    orgId,
    connId,
    userId,
    canRead: can_read,
    canUpdate: can_update,
    canDelete: can_delete,
  });
}

export function serversGrantRevoke(
  profileId: string,
  orgId: string,
  connId: string,
  userId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections/${encodeURIComponent(connId)}/grants/${encodeURIComponent(userId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_grant_revoke", { profileId, orgId, connId, userId });
}

/** Turn a raw connect-failure string into something a user can act on.
 *  Both `router.rs`'s `Auth` extractor (desktop, via the Tauri client) and
 *  `web.ts`'s `errorText` (web, via fetch) surface an expired/invalid
 *  session as text containing "invalid" and "session" — recognize that
 *  shape specifically instead of showing the raw "401 ... invalid,
 *  missing, or expired session" string with no indication of what to do
 *  about it. */
export function friendlyConnectError(name: string, e: unknown): string {
  const raw = String(e);
  if (/invalid.*session|session.*expired/i.test(raw)) {
    return `Your sign-in for "${name}" has expired. Remove and re-add this server to sign in again.`;
  }
  return `Couldn't connect to "${name}": ${raw}`;
}
