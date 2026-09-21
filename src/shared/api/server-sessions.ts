import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall, wcallEmpty } from "./web";
import { webSessionEnded } from "./web-session";

// Sign out and My devices (spec 0010, short lived sessions and devices). The
// server decides what a person may see and end, and only ever answers about
// their own sessions, so nothing here checks anything before calling.

/** One device signed in as the caller. */
export interface DeviceSession {
  id: string;
  device_name: string;
  platform: "desktop" | "web";
  created_ms: number;
  last_used_ms: number;
  /** True for the session this call was made with: This device. */
  current: boolean;
}

/** Sign this browser out: end its session on the server, then drop the token
 *  and tell the page. Best effort: the token is dropped either way. Returns
 *  whether the server was told. */
export async function webSignOut(): Promise<boolean> {
  let told = true;
  try {
    await wcallEmpty("POST", "/v1/auth/logout", undefined, true);
  } catch {
    told = false;
  }
  webSessionEnded();
  return told;
}

/** Sign out of a server, ending this device's session there. Returns whether
 *  the server was told: `false` means it could not be reached, so this app is
 *  signed out but the device may still be listed under My devices. */
export function serversSignOut(profileId: string): Promise<boolean> {
  if (WEB) return webSignOut();
  return invoke("servers_sign_out", { profileId });
}

/** The caller's devices, most recently used first. */
export function serversSessionsList(
  profileId: string,
): Promise<DeviceSession[]> {
  if (WEB) return wcall("GET", "/v1/me/sessions", undefined, true);
  return invoke("servers_sessions_list", { profileId });
}

/** End one device. Resolves true when it was this one, so the caller is signed
 *  out now (on the web the page shows its sign in dialog). */
export async function serversSessionEnd(
  profileId: string,
  session: DeviceSession,
): Promise<boolean> {
  if (WEB) {
    await wcallEmpty(
      "DELETE",
      `/v1/me/sessions/${encodeURIComponent(session.id)}`,
      undefined,
      true,
    );
    if (session.current) webSessionEnded();
    return session.current;
  }
  return invoke("servers_session_end", { profileId, sessionId: session.id });
}

/** Sign out everywhere: every device, this one included. */
export async function serversSessionsEndAll(profileId: string): Promise<void> {
  if (WEB) {
    await wcallEmpty("DELETE", "/v1/me/sessions", undefined, true);
    webSessionEnded();
    return;
  }
  return invoke("servers_sessions_end_all", { profileId });
}

/** The server owner ends every session of a person. The server answers 403 to
 *  anyone else. No screen calls this yet (the scope lists the owner's button
 *  as a follow up). Resolves with how many sessions ended. */
export async function serversOwnerEndSessions(
  profileId: string,
  userId: string,
): Promise<number> {
  if (WEB) {
    const r = await wcall<{ ended: number }>(
      "DELETE",
      `/v1/admin/users/${encodeURIComponent(userId)}/sessions`,
      undefined,
      true,
    );
    return r.ended;
  }
  return invoke("servers_owner_end_sessions", { profileId, userId });
}
