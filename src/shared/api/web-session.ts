/**
 * The web build's device session (spec 0010, short lived sessions and devices).
 *
 * The page holds only a 15 minute access token, in memory. The long lived
 * renewal token is an HttpOnly cookie (`dh_refresh`, path `/auth`) that page
 * scripts cannot read, so a script on the page can never carry a session off.
 * Nothing here touches `localStorage`, except the random id that names this
 * browser as a device, which is not a secret.
 *
 * Renewal is one call to `/auth/refresh` with an empty JSON body. Callers that
 * need a token at the same time share one call in this tab, and
 * `navigator.locks` lines up tabs so they do not renew at the same moment (the
 * server also answers a repeat within 30 seconds with the same new token, so a
 * near miss is harmless).
 */

const DEVICE_KEY = "dh.device_id";
const PKCE_KEY = "dh.pkce";
const LOCK_NAME = "dh-session-renew";
/** Renew when the token has this long or less to live. */
const RENEW_EARLY_MS = 60_000;

/** Fired on `window` when a session that was working has ended (a renewal was
 *  refused), so the page can show the sign in dialog. */
export const SIGNED_OUT_EVENT = "dh:web-signed-out";

/** The renewal was refused: there is no session any more. */
export class SignedOutError extends Error {
  constructor() {
    super("signed_out");
    this.name = "SignedOutError";
  }
}

export function isSignedOut(e: unknown): boolean {
  return e instanceof SignedOutError || String(e).includes("signed_out");
}

interface Access {
  token: string;
  expiresAt: number;
}

let access: Access | null = null;
/** True once this page has held a session, so a refused renewal after that is
 *  news (the startup check for a session is not). */
let hadSession = false;
let renewing: Promise<string> | null = null;

export interface TokenReply {
  access_token: string;
  expires_in: number;
}

/** Keep the access token a sign in or renewal just returned. */
export function webSetAccess(reply: TokenReply): string {
  access = {
    token: reply.access_token,
    expiresAt: Date.now() + reply.expires_in * 1000,
  };
  hadSession = true;
  return reply.access_token;
}

/** Forget the access token (the session is over, or this page signed out). */
export function webClearAccess(): void {
  access = null;
}

/** The session ended (this page signed out, or the server refused a renewal):
 *  drop the token and tell the page, so it shows the sign in dialog. */
export function webSessionEnded(): void {
  webClearAccess();
  hadSession = false;
  window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

function freshToken(): string | null {
  if (!access) return null;
  return access.expiresAt - Date.now() > RENEW_EARLY_MS ? access.token : null;
}

/** The access token to send now, renewing it first when it is missing or
 *  about to expire. Rejects with {@link SignedOutError} when there is no
 *  session to renew. */
export async function webAccessToken(): Promise<string> {
  return freshToken() ?? (await webRenew());
}

/** Renew the session. `rejected` is a token the server just refused: it is
 *  never handed back, even if it still looks fresh. */
export function webRenew(rejected?: string): Promise<string> {
  if (renewing) return renewing;
  const run = async () => {
    // Another caller (or another tab's turn) may have renewed while this one
    // waited for the lock.
    const fresh = freshToken();
    if (fresh && fresh !== rejected) return fresh;
    return requestRenewal();
  };
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  const p = locks ? locks.request(LOCK_NAME, run) : run();
  renewing = p.finally(() => {
    renewing = null;
  });
  return renewing;
}

async function requestRenewal(): Promise<string> {
  const res = await fetch("/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    credentials: "same-origin",
    cache: "no-store",
  });
  // 401: the session ended. 400: no cookie at all (never signed in here, or
  // signed out in another tab). Either way there is no session.
  if (res.status === 401 || res.status === 400) {
    if (hadSession) webSessionEnded();
    else webClearAccess();
    throw new SignedOutError();
  }
  if (!res.ok) throw new Error(`renewal failed: HTTP ${res.status}`);
  return webSetAccess((await res.json()) as TokenReply);
}

/** Whether a session exists, found by trying to renew it once. Used at page
 *  load: a refused renewal here is the normal "not signed in" answer, not an
 *  event. A network error is thrown, so the caller can say the server is
 *  unreachable instead of showing a sign in. */
export async function webRestoreSession(): Promise<boolean> {
  if (freshToken()) return true;
  try {
    await webRenew();
    return true;
  } catch (e) {
    if (isSignedOut(e)) return false;
    throw e;
  }
}

// ---- Sign in ---------------------------------------------------------------

/** A random id that names this browser as a device, made once. */
export function webDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    // Storage blocked: an id for this page load still works, and the person
    // simply shows up as a new device next time.
    return (memoryDeviceId ??= crypto.randomUUID());
  }
}
let memoryDeviceId: string | undefined;

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A PKCE pair: a secret this page keeps to itself, and its SHA 256 hash to
 *  send when the sign in starts. The login code that comes back in the address
 *  is useless without the secret. */
export async function makePkce(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

/** Keep the verifier across the redirect to the provider and back. Only this
 *  tab can read it, and only until it is used. */
export function rememberVerifier(verifier: string): void {
  try {
    sessionStorage.setItem(PKCE_KEY, verifier);
  } catch {
    // Blocked storage: the sign in cannot finish, and says so on return.
  }
}

/** The verifier kept before the redirect, removed as it is read. */
export function takeVerifier(): string | null {
  try {
    const v = sessionStorage.getItem(PKCE_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Trade the login code from the address for a session. The renewal token
 *  arrives only as the cookie; the access token is kept in memory. */
export async function webExchange(code: string): Promise<void> {
  const verifier = takeVerifier();
  if (!verifier) {
    throw new Error("This sign in was not started on this page. Try again.");
  }
  const res = await fetch("/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      device_id: webDeviceId(),
      platform: "web",
    }),
  });
  if (!res.ok) throw new Error(`Sign in failed: HTTP ${res.status}`);
  webSetAccess((await res.json()) as TokenReply);
}
