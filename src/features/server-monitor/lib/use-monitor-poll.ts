import { useCallback, useEffect, useRef, useState } from "react";
import {
  monitorSnapshot,
  monitorUnavailableText,
  type MonitorSnapshot,
} from "@/shared/api";

/** After this many failed refreshes in a row the poller pauses (AC-9). */
export const MAX_FAILURES = 3;

/** `idle`: the tab is hidden or the connection is not connected. `frozen`:
 *  a row is selected, or a row menu or confirm is open. `failed`: three
 *  refreshes failed in a row. `blocked`: the server cannot be monitored
 *  (AC-16). `paused`: the rate is Paused. */
export type PollStatus =
  | "idle"
  | "polling"
  | "frozen"
  | "paused"
  | "failed"
  | "blocked";

export interface MonitorPoll {
  snapshot: MonitorSnapshot | null;
  status: PollStatus;
  /** The last failure's text, or the refusal's words when blocked. */
  error: string | null;
  /** `Date.now()` when the last snapshot arrived. */
  receivedAt: number | null;
  /** Seconds the last refresh took, when that was longer than the rate. */
  slowSeconds: number | null;
  /** Clear a failure or refusal and poll again. */
  retry: () => void;
  /** Refresh now (after a kill), then carry on at the rate. */
  refreshNow: () => void;
}

interface PollState {
  snapshot: MonitorSnapshot | null;
  receivedAt: number | null;
  error: string | null;
  failures: number;
  blocked: boolean;
  slowSeconds: number | null;
}

const EMPTY: PollState = {
  snapshot: null,
  receivedAt: null,
  error: null,
  failures: 0,
  blocked: false,
  slowSeconds: null,
};

/** Polls the server monitor snapshot for one connection (spec 0025).
 *
 *  A `setTimeout` chain started after each answer, never `setInterval`, so
 *  two refreshes never run at once (AC-10). It runs only while the tab is
 *  visible, the connection is connected, nothing is frozen and the rate is
 *  not Paused, and refreshes at once when any of those comes back (AC-9). A
 *  request still in flight when it stops is dropped on arrival. */
export function useMonitorPoll(
  connId: string,
  opts: {
    visible: boolean;
    connected: boolean;
    frozen: boolean;
    /** 0 = Paused. */
    refresh_ms: number;
  },
): MonitorPoll {
  const { visible, connected, frozen, refresh_ms } = opts;
  const [state, setState] = useState<PollState>(EMPTY);
  const [kick, setKick] = useState(0);
  const inflight = useRef<Promise<void> | null>(null);

  const stopped = state.blocked || state.failures >= MAX_FAILURES;
  const active = connected && visible && !frozen && refresh_ms > 0 && !stopped;

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      if (!alive) return;
      const started = performance.now();
      const call = monitorSnapshot(connId).then(
        (snapshot) => {
          if (!alive) return;
          const took = performance.now() - started;
          setState((s) => ({
            ...s,
            snapshot,
            receivedAt: Date.now(),
            error: null,
            failures: 0,
            slowSeconds: took > refresh_ms ? Math.ceil(took / 1000) : null,
          }));
        },
        (e: unknown) => {
          if (!alive) return;
          const refusal = monitorUnavailableText(e);
          if (refusal !== null) {
            setState((s) => ({ ...s, blocked: true, error: refusal }));
          } else {
            setState((s) => ({
              ...s,
              failures: s.failures + 1,
              error: e instanceof Error ? e.message : String(e),
            }));
          }
        },
      );
      inflight.current = call;
      void call.then(() => {
        if (inflight.current === call) inflight.current = null;
        if (alive) timer = setTimeout(tick, refresh_ms);
      });
    };

    // Whatever an earlier run left in flight answers first.
    const pending = inflight.current;
    if (pending) void pending.then(tick);
    else tick();

    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active, connId, refresh_ms, kick]);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, failures: 0, blocked: false, error: null }));
    setKick((k) => k + 1);
  }, []);
  const refreshNow = useCallback(() => setKick((k) => k + 1), []);

  const status: PollStatus = state.blocked
    ? "blocked"
    : state.failures >= MAX_FAILURES
      ? "failed"
      : refresh_ms === 0
        ? "paused"
        : !connected || !visible
          ? "idle"
          : frozen
            ? "frozen"
            : "polling";

  return {
    snapshot: state.snapshot,
    status,
    error: state.error,
    receivedAt: state.receivedAt,
    slowSeconds: state.slowSeconds,
    retry,
    refreshNow,
  };
}
