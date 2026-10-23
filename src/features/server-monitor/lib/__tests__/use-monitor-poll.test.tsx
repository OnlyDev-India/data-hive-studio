import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitorSnapshot } from "@/shared/api";

const snapshotCall = vi.fn<(connId: string) => Promise<MonitorSnapshot>>();

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  monitorSnapshot: (connId: string) => snapshotCall(connId),
}));

import { MONITOR_UNAVAILABLE_PREFIX } from "@/shared/api";
import { useMonitorPoll } from "../use-monitor-poll";

const SNAP = {
  taken_at: "now",
  engine: "postgres",
  server_version: "16.4",
  node_note: null,
  app_name_self: "DH Studio (ab12)",
  visibility: { level: "full", missing: [] },
  counts: {
    total: 0,
    active: 0,
    idle: 0,
    idle_in_tx: 0,
    waiting: 0,
    blocked: 0,
    slow_at_5s: 0,
  },
  total_sessions: 0,
  sessions: [],
  blocks: [],
} satisfies MonitorSnapshot;

type Opts = Parameters<typeof useMonitorPoll>[1];
const BASE: Opts = { visible: true, connected: true, frozen: false, refresh_ms: 2000 };

/** Let resolved promises and the effects they trigger settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function render(opts: Opts = BASE) {
  return renderHook((o: Opts) => useMonitorPoll("c1", o), { initialProps: opts });
}

beforeEach(() => {
  vi.useFakeTimers();
  snapshotCall.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMonitorPoll", () => {
  it("refreshes at once, then again a rate after each answer", async () => {
    snapshotCall.mockResolvedValue(SNAP);
    const { result } = render();
    await flush();
    expect(snapshotCall).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toEqual(SNAP);
    expect(result.current.status).toBe("polling");
    await advance(1999);
    expect(snapshotCall).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(snapshotCall).toHaveBeenCalledTimes(2);
  });

  it("never starts a refresh while the last one is still out (AC-10)", async () => {
    let answer: (s: MonitorSnapshot) => void = () => {};
    snapshotCall.mockImplementation(
      () => new Promise<MonitorSnapshot>((r) => (answer = r)),
    );
    const { result } = render();
    await advance(20_000);
    expect(snapshotCall).toHaveBeenCalledTimes(1);
    await act(async () => answer(SNAP));
    await flush();
    // It took longer than the rate: the lag note says how long.
    expect(result.current.slowSeconds).toBe(20);
    await advance(2000);
    expect(snapshotCall).toHaveBeenCalledTimes(2);
  });

  it("pauses after 3 failures in a row and resumes on Retry (AC-9)", async () => {
    snapshotCall.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const { result } = render();
    await flush();
    await advance(2000);
    await advance(2000);
    expect(snapshotCall).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("failed");
    expect(result.current.error).toMatch(/statement timeout/);
    await advance(10_000);
    expect(snapshotCall).toHaveBeenCalledTimes(3);

    snapshotCall.mockResolvedValue(SNAP);
    act(() => result.current.retry());
    await flush();
    expect(snapshotCall).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe("polling");
  });

  it("stops on a server that cannot be monitored, without counting it as a failure (AC-16)", async () => {
    snapshotCall.mockRejectedValue(
      new Error(`${MONITOR_UNAVAILABLE_PREFIX} This server does not let DH Studio read current operations.`),
    );
    const { result } = render();
    await flush();
    expect(result.current.status).toBe("blocked");
    expect(result.current.error).toBe(
      "This server does not let DH Studio read current operations.",
    );
    await advance(10_000);
    expect(snapshotCall).toHaveBeenCalledTimes(1);
  });

  it("waits while hidden and refreshes at once when the tab comes back (AC-9)", async () => {
    snapshotCall.mockResolvedValue(SNAP);
    const { result, rerender } = render({ ...BASE, visible: false });
    await advance(10_000);
    expect(snapshotCall).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    rerender({ ...BASE, visible: true });
    await flush();
    expect(snapshotCall).toHaveBeenCalledTimes(1);
  });

  it("freezes while you look, and drops an answer that arrives frozen", async () => {
    let answer: (s: MonitorSnapshot) => void = () => {};
    snapshotCall.mockImplementation(
      () => new Promise<MonitorSnapshot>((r) => (answer = r)),
    );
    const { result, rerender } = render();
    await flush();
    rerender({ ...BASE, frozen: true });
    expect(result.current.status).toBe("frozen");
    await act(async () => answer(SNAP));
    await flush();
    expect(result.current.snapshot).toBeNull();
    await advance(10_000);
    expect(snapshotCall).toHaveBeenCalledTimes(1);
  });

  it("does not poll while Paused or disconnected (AC-2, AC-20)", async () => {
    snapshotCall.mockResolvedValue(SNAP);
    const paused = render({ ...BASE, refresh_ms: 0 });
    await advance(10_000);
    expect(paused.result.current.status).toBe("paused");
    paused.unmount();
    const gone = render({ ...BASE, connected: false });
    await advance(10_000);
    expect(gone.result.current.status).toBe("idle");
    expect(snapshotCall).not.toHaveBeenCalled();
  });
});
