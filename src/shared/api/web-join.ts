// The shareable link's code on the web (spec 0011). A link looks like
// `https://server/?join=<code>`. The code is a secret, so the page reads it
// once, keeps it in `sessionStorage` (this tab only, gone when the tab
// closes) and removes it from the address bar at once.

const KEY = "dh.web.join";
/** Same shape the server mints: 12 random bytes as 24 hex characters. */
const CODE = /^[0-9a-f]{24}$/i;

/** The link's code from `?join=` in an address, or `null` when it is missing
 *  or not shaped like a code. */
export function joinCodeFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("join")?.trim() ?? "";
  return CODE.test(value) ? value : null;
}

/** `search` without the `join` parameter (no leading `?`). */
export function stripJoinParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("join");
  return params.toString();
}

/** What a person pasted into "Have an invite code?": a whole link, or the bare
 *  code. Returns the code either way, or the text as typed when it is neither
 *  (the server answers 404 for a bad one). */
export function parseJoinCode(input: string): string {
  const text = input.trim();
  try {
    const fromUrl = joinCodeFromSearch(new URL(text).search);
    if (fromUrl) return fromUrl;
  } catch {
    // Not a URL: treat it as the code itself.
  }
  return text;
}

/** The link an owner or admin shares: the server address plus `/?join=`. */
export function joinLink(serverAddress: string, code: string): string {
  return `${serverAddress.replace(/\/+$/, "")}/?join=${code}`;
}

export function rememberJoinCode(code: string): void {
  try {
    sessionStorage.setItem(KEY, code);
  } catch {
    // Storage blocked: the link still works if sign in needs no page reload.
  }
}

export function pendingJoinCode(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function forgetJoinCode(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
