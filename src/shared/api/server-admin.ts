import { invoke } from "@tauri-apps/api/core";
import {
  WEB,
  wcall,
  wcallEmpty,
  webListServers,
  webServerConfig,
  webRemoveServer,
} from "./web";
import { isSignedOut, webRestoreSession } from "./web-session";
import { webSignOut } from "./server-sessions";
import { remoteOf } from "./dispatch";
import type { SharedDbKind } from "./types";

export type OrgRole = "member" | "admin" | "owner";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_ms: number;
}

export interface MeOrg extends Organization {
  role: OrgRole;
}

/** A person's role on the whole server (not in an org). */
export type ServerRole = "owner" | "admin" | "member";

export interface MeResult {
  user_id: string;
  email: string;
  name: string;
  server_role: ServerRole;
  /** Only ever true for an admin an owner switched it on for. */
  can_manage_roles: boolean;
  /** Whether this person may create an organization right now: a server
   *  owner always, anyone else under the server's open policy or an admin
   *  the owner switched it on for, each once. */
  can_create_org: boolean;
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
 *  `gateway.rs::create_connection`'s requirement of being a member of the
 *  org (every org role may publish). */
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
  /** False when the app holds no session for this server (a renewal was
   *  refused, or the person signed out): offer Sign in again. */
  signed_in: boolean;
}

export interface ServerConn {
  id: string;
  name: string;
  kind?: SharedDbKind;
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
  /** MongoDB only: disable retryable writes — required for Amazon DocumentDB. */
  retry_writes?: boolean;
  /** MongoDB only: replica set name — required by a real Amazon DocumentDB
   *  cluster (typically "rs0"). */
  replica_set?: string | null;
  pool_max?: number | null;
  pool_min?: number | null;
  connect_timeout_secs?: number | null;
  idle_timeout_secs?: number | null;
  /** PostgreSQL only. */
  max_lifetime_secs?: number | null;
  /** MongoDB only. */
  server_selection_timeout_secs?: number | null;
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
// loopback listener (`servers_oauth_login` in src-tauri/src/servers/session.rs);
// web just redirects the whole page (`webOAuthStartUrl`, handled in WebGate on
// the way back in). Either way this module never sees a password, and never a
// token: the desktop session lives in Rust, and the web session in
// `web-session.ts` (memory plus an HttpOnly cookie).

/** Which OAuth providers `url` has credentials configured for — lets the
 *  sign-in form show only the buttons that will actually work. */
export function serversOAuthProviders(url: string): Promise<string[]> {
  if (WEB) {
    return wcall<string[]>("GET", "/auth/providers", undefined);
  }
  return invoke("servers_oauth_providers", { url });
}

/** How a desktop sign in ended: signed in, the server has no owner yet (a
 *  claim ticket to send with the setup code, see `serversClaim`), or refused
 *  (a code for `refusalMessage`, and the person's own email). */
export type OAuthLoginOutcome =
  | { kind: "signed_in"; me: MeResult }
  | { kind: "claim"; ticket: string }
  | { kind: "refused"; error: string; email: string };

/** Desktop only: run a full OAuth round trip. A signed in result carries the
 *  identity + org list; the session itself stays in Rust. Does not save a
 *  profile. */
export function serversOAuthLogin(
  url: string,
  provider: string,
): Promise<OAuthLoginOutcome> {
  return invoke("servers_oauth_login", { url, provider });
}

/** Look for a still-usable session this app already holds for `url` (one per
 *  server, shared by every saved profile on it, since a session isn't
 *  org-scoped). Lets "add another org on a server I've already signed in to"
 *  skip a fresh OAuth round trip. Never throws — `null` means "nothing
 *  usable, fall back to a normal sign-in". */
export async function serversReuseSession(
  url: string,
): Promise<{ me: MeResult } | null> {
  if (WEB) {
    try {
      if (!(await webRestoreSession())) return null;
      return { me: await wcall<MeResult>("GET", "/v1/me", undefined, true) };
    } catch {
      return null;
    }
  }
  return invoke("servers_reuse_session", { url });
}

/** Create a brand-new organization on the server the person just signed in to. */
export function serversOrgCreateNew(
  url: string,
  name: string,
): Promise<Organization> {
  if (WEB) {
    return wcall<Organization>("POST", "/v1/orgs", { name }, true);
  }
  return invoke("servers_org_create_new", { url, name });
}

/** Desktop only: persist a profile (servers.json) for a server the user has
 *  OAuth-signed-in to and chosen an org on. The profile carries no token: it
 *  finds the session by its server address. Web instead calls `webAddServer`
 *  directly (see `connect-server-dialog.tsx`). */
export function serversSaveProfile(
  name: string,
  url: string,
  org_id: string,
): Promise<{ id: string; name: string; url: string; org_id: string }> {
  return invoke("servers_save_profile", { name, url, orgId: org_id });
}

export async function serversList(): Promise<ServerProfileView[]> {
  if (WEB) {
    // One session for the whole origin, so one check covers every profile.
    let signed_in = true;
    let connected = false;
    try {
      signed_in = await webRestoreSession();
      connected = signed_in;
    } catch {
      // Unreachable server: unknown, so not shown as signed out.
    }
    return webListServers().map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      org_id: s.org_id,
      connected,
      signed_in,
    }));
  }
  return invoke("servers_list");
}

/** Remove a saved profile. When it was the last one for its server, the
 *  session there ends too. */
export async function serversRemove(profileId: string): Promise<void> {
  if (WEB) {
    webRemoveServer(profileId);
    if (webListServers().length === 0) await webSignOut();
    return;
  }
  return invoke("servers_remove", { profileId });
}

export function serversConnect(profileId: string): Promise<ServerSession> {
  if (WEB) {
    const cfg = webServerConfig(profileId);
    if (!cfg) return Promise.reject(new Error("server profile not found"));
    return Promise.all([
      wcall<MeResult>("GET", "/v1/me", undefined, true),
      wcall<ServerConn[]>(
        "GET",
        `/v1/orgs/${encodeURIComponent(cfg.org_id)}/connections`,
        undefined,
        true,
      ),
    ])
      .catch((e: unknown) => {
        // Signed out is its own answer, not a connection problem.
        if (isSignedOut(e)) throw e;
        // Network-level failure (unreachable host) — fetch throws a bare
        // TypeError with no context. Give the user the cause.
        const detail =
          e instanceof TypeError
            ? "cannot reach the server that served this page — check that it is running"
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
  kind?: SharedDbKind;
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
  /** MongoDB only: disable retryable writes — required for Amazon DocumentDB. */
  retry_writes?: boolean;
  /** MongoDB only: replica set name — required by a real Amazon DocumentDB
   *  cluster (typically "rs0"). */
  replica_set?: string | null;
  pool_max?: number | null;
  pool_min?: number | null;
  connect_timeout_secs?: number | null;
  idle_timeout_secs?: number | null;
  /** PostgreSQL only. */
  max_lifetime_secs?: number | null;
  /** MongoDB only. */
  server_selection_timeout_secs?: number | null;
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
    return wcall<unknown>(
      "POST",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections`,
      input,
      true,
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
    return wcall<unknown>(
      "PUT",
      `/v1/connections/${encodeURIComponent(remoteOf(connId))}`,
      input,
      true,
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
    return wcallEmpty(
      "DELETE",
      `/v1/connections/${encodeURIComponent(connId)}`,
      undefined,
      true,
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
    return wcall<ServerCredentials>(
      "GET",
      `/v1/connections/${encodeURIComponent(remoteOf(connId))}/credentials`,
      undefined,
      true,
    );
  }
  return invoke("servers_fetch_credentials", { profileId, connId });
}

/** Release (close) a server-side connection pool. Web clients call this on
 *  page unload so the server frees resources immediately instead of waiting
 *  for the idle timeout. */
export function serversReleaseConnection(connId: string): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "POST",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/close`,
      undefined,
      true,
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
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
      undefined,
      true,
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
    return wcallEmpty(
      "PUT",
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { role },
      true,
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
    return wcallEmpty(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      undefined,
      true,
    );
  }
  return invoke("servers_org_remove_member", { profileId, orgId, userId });
}

export function serversOrgAudit(
  profileId: string,
  orgId: string,
  limit = 100,
): Promise<AuditEntry[]> {
  if (WEB) {
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/audit?limit=${limit}`,
      undefined,
      true,
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
    return wcall(
      "GET",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections/${encodeURIComponent(connId)}/grants`,
      undefined,
      true,
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
    return wcallEmpty(
      "PUT",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections/${encodeURIComponent(connId)}/grants/${encodeURIComponent(userId)}`,
      { can_read, can_update, can_delete },
      true,
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
    return wcallEmpty(
      "DELETE",
      `/v1/orgs/${encodeURIComponent(orgId)}/connections/${encodeURIComponent(connId)}/grants/${encodeURIComponent(userId)}`,
      undefined,
      true,
    );
  }
  return invoke("servers_grant_revoke", { profileId, orgId, connId, userId });
}

/** The server refused because the person is not (or no longer) in the
 *  organization: they were removed, or they left. Not a sign in problem. */
export function isNoOrgAccess(e: unknown): boolean {
  return /\b403\b|not a member of this organization/i.test(String(e));
}

/** Turn a connect failure into something a user can act on. A refused
 *  renewal (`signed_out`, from the Tauri client or the web session) is not a
 *  connection problem: the answer is to sign in again. */
export function friendlyConnectError(name: string, e: unknown): string {
  if (isSignedOut(e)) {
    return `You're signed out of "${name}". Choose Sign in again from the Team servers menu.`;
  }
  if (isNoOrgAccess(e)) {
    return `You no longer have access to "${name}". An owner or admin can invite you again.`;
  }
  return `Couldn't connect to "${name}": ${String(e)}`;
}
