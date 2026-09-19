import type { ConnGuard } from "./types";

// Read only connections (spec 0007). The Rust side refuses a write with an
// error whose text starts with this constant; it never says which connection
// it was or where to turn the flag off, because it does not know whether the
// connection is local or shared. The frontend adds that hint here.

/** Every read only refusal from the backend starts with this text. Keep in
 *  step with `READ_ONLY_PREFIX` in `crates/dh-core/src/db/read_only.rs`. */
export const READ_ONLY_PREFIX = "Read only connection:";

const LOCAL_HINT = "Turn off read only in the connection settings.";
const SHARED_HINT = "Ask an org admin to turn it off.";

function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True when `err` (a string, an `Error`, or anything a failed call rejects
 *  with) is the backend's read only refusal. */
export function isReadOnlyError(err: unknown): boolean {
  return errorText(err).includes(READ_ONLY_PREFIX);
}

/** Where to go to turn read only off: a shared (team server) connection is
 *  changed by an org admin, a local one in its own settings. */
export function readOnlyHint(shared: boolean): string {
  return shared ? SHARED_HINT : LOCAL_HINT;
}

/** A refusal with the hint added. Anything that is not a read only refusal,
 *  and a refusal that already carries the hint, comes back untouched. A
 *  string stays a string (the desktop backend rejects with plain strings, and
 *  callers print those with `String(e)`); an `Error` becomes a new `Error`. */
export function withReadOnlyHint(err: unknown, shared: boolean): unknown {
  if (!isReadOnlyError(err)) return err;
  const text = errorText(err);
  const hint = readOnlyHint(shared);
  if (text.endsWith(hint)) return err;
  const hinted = `${text} ${hint}`;
  return typeof err === "string" ? hinted : new Error(hinted, { cause: err });
}

/** The four guard fields of a connection (a live `ConnectionInfo`, a saved
 *  record, or a form), for passing on when the connection is opened again.
 *  Absent fields stay absent so a legacy connection round trips unchanged. */
export function connGuardOf(conn: ConnGuard): ConnGuard {
  const guard: ConnGuard = {};
  if (conn.read_only !== undefined) guard.read_only = conn.read_only;
  if (conn.env_label !== undefined) guard.env_label = conn.env_label;
  if (conn.env_color !== undefined) guard.env_color = conn.env_color;
  if (conn.confirm_writes !== undefined) {
    guard.confirm_writes = conn.confirm_writes;
  }
  return guard;
}
