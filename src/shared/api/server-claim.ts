import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall } from "./web";
import { webDeviceId, webSetAccess, type TokenReply } from "./web-session";
import type { MeResult } from "./server-admin";

// A new team server is closed. Signing in on it returns a claim ticket, and
// whoever enters the setup code from the server log becomes its owner. After
// that only invited people can sign in. This file holds the parts of that
// flow the desktop app and the web page share: reading how a sign in ended,
// the claim call, and the plain words for each refusal.

/** How a sign in ended, as read back from the address the browser returns to.
 *  `old_server` is a server from before device sessions, which answers with a
 *  `token=` this page must not use or keep. */
export type SignInReturn =
  | { kind: "code"; code: string }
  | { kind: "ticket"; ticket: string }
  | { kind: "refused"; error: string; email: string }
  | { kind: "old_server" };

const RETURN_KEYS = ["code", "token", "ticket", "error", "email"];

/** Shown when the server answers a sign in the old way (spec 0010, AC-19). */
export const OLD_SERVER_MESSAGE =
  "This server needs updating to work with this version of DH Studio";

/** Read the sign in outcome out of a query string (`?code=…`, `?ticket=…` or
 *  `?error=…&email=…`). `null` when the page was not a sign in return. */
export function parseSignInReturn(search: string): SignInReturn | null {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  if (code) return { kind: "code", code };
  const ticket = params.get("ticket");
  if (ticket) return { kind: "ticket", ticket };
  const error = params.get("error");
  if (error)
    return { kind: "refused", error, email: params.get("email") ?? "" };
  if (params.get("token")) return { kind: "old_server" };
  return null;
}

/** The query string without the sign in parameters (no leading `?`), so a
 *  refresh does not try to use a token or ticket a second time. */
export function stripSignInParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of RETURN_KEYS) params.delete(key);
  return params.toString();
}

/** Plain words for a refused sign in. The server sends a code and the
 *  person's own email, nothing about anyone else. */
export function refusalMessage(code: string, email: string): string {
  const who = email ? `“${email}”` : "That email";
  switch (code) {
    case "not_invited":
      return `${who} hasn't been invited to this server. Ask a server owner or admin to invite that email, then sign in again.`;
    case "invite_expired":
      return `The invite for ${who} has expired. Ask a server owner or admin to send a new one, then sign in again.`;
    case "email_unverified":
      return `${email ? who : "Your account"} has no verified email address. Verify your email with your provider, or use another sign in, then try again.`;
    case "account_link_conflict":
      return `${who} already belongs to an account here that uses a different account from the same provider. Sign in with the account you used before.`;
    default:
      return `Sign in was refused (${code}).`;
  }
}

/** Plain words for a refused claim, from the code the server sent. */
export function claimErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("code_invalid")) {
    return "That setup code isn't right. Check the server log and try again.";
  }
  if (raw.includes("ticket_invalid")) {
    return "This sign in has expired. Sign in again to continue.";
  }
  if (raw.includes("already_claimed")) {
    return "Someone has already claimed this server. Sign in again: you will need an invite.";
  }
  return `Couldn't claim the server: ${raw}`;
}

/** Whether a claim error means the ticket is no good, so the only way
 *  forward is to sign in again (as opposed to retyping the code). */
export function claimNeedsNewSignIn(e: unknown): boolean {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.includes("ticket_invalid") || raw.includes("already_claimed");
}

/** Claim a server that has no owner: the ticket from a sign in plus the setup
 *  code from the server log. The caller becomes the owner and is signed in like
 *  anyone else. A refusal rejects with the server's code (`code_invalid`, …). */
export async function serversClaim(
  url: string,
  ticket: string,
  code: string,
): Promise<{ me: MeResult }> {
  if (!WEB) return invoke("servers_claim", { url, ticket, code });
  const res = await fetch("/auth/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({
      ticket,
      code,
      device_id: webDeviceId(),
      platform: "web",
    }),
  });
  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) reason = body.error;
    } catch {
      // keep the status text
    }
    throw new Error(reason);
  }
  // The renewal token arrived as the cookie; keep the access token in memory.
  webSetAccess((await res.json()) as TokenReply);
  return { me: await wcall<MeResult>("GET", "/v1/me", undefined, true) };
}
