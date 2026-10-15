import { WEB, webInfo } from "./web";
import { dispatchDbCall } from "./dispatch";
import type {
  DbKind,
  KillOutcome,
  KillRequest,
  MonitorSnapshot,
} from "./types";

/** Engines the server monitor reads (spec 0025). MySQL joins later. */
export function canMonitor(kind: DbKind | undefined): boolean {
  return kind === "postgres" || kind === "mongodb";
}

/** Every "this server cannot be monitored" answer starts with this (an old
 *  Postgres, a Mongo without `$currentOp`). Keep in step with
 *  `MONITOR_UNAVAILABLE_PREFIX` in `crates/dh-core/src/db/monitor.rs`. */
export const MONITOR_UNAVAILABLE_PREFIX = "Server monitor unavailable:";

/** The refusal's own words when `error` says the server cannot be monitored,
 *  else null. */
export function monitorUnavailableText(error: unknown): string | null {
  const text = String(error instanceof Error ? error.message : error);
  const at = text.indexOf(MONITOR_UNAVAILABLE_PREFIX);
  if (at < 0) return null;
  return text.slice(at + MONITOR_UNAVAILABLE_PREFIX.length).trim();
}

/** One whole server snapshot. On the web the server reopens a forgotten
 *  handle and repeats the call once, like every other data call. */
export function monitorSnapshot(connId: string): Promise<MonitorSnapshot> {
  return dispatchDbCall<MonitorSnapshot>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/monitor`,
    localCmd: "monitor_snapshot",
    args: { connId },
  });
}

/** Cancel, terminate or kill one session, only while it is still the one in
 *  `req`. A refusal by the server comes back as `result: "refused"`. */
export function monitorKill(
  connId: string,
  req: KillRequest,
): Promise<KillOutcome> {
  return dispatchDbCall<KillOutcome>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/monitor/kill`,
    httpBody: req,
    localCmd: "monitor_kill",
    args: { connId, req },
  });
}

let serverReadOnly: Promise<boolean> | null = null;

/** Whether the team server runs with `DH_READ_ONLY=1`, which refuses every
 *  kill (AC-14). Always false on the desktop. Asked once per page. */
export function monitorKillLocked(): Promise<boolean> {
  if (!WEB) return Promise.resolve(false);
  serverReadOnly ??= webInfo()
    .then((info) => info.read_only)
    .catch(() => false);
  return serverReadOnly;
}
