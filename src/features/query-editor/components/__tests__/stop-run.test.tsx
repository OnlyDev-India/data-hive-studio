import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const cancelRun = vi.fn().mockResolvedValue({ state: "stopped" });

vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  cancelRun: (...args: unknown[]) => cancelRun(...args),
}));

import { useStopRuns } from "../editor-tab";
import { QueryLoadingOverlay } from "@/shared/components/data-grid/query-loading-overlay";

afterEach(() => {
  cleanup();
  cancelRun.mockClear();
});

const runs = [
  { id: 1, running: true, run_id: "run-a", stopping: false },
  { id: 2, running: true, run_id: "run-b", stopping: false },
];

describe("stopping a run from its result pane", () => {
  it("cancels only that tab's run and marks it stopping", async () => {
    const patch = vi.fn();
    const { result } = renderHook(() => useStopRuns("c1", runs, patch));
    await act(async () => result.current.stop_run(2));
    expect(cancelRun).toHaveBeenCalledOnce();
    expect(cancelRun).toHaveBeenCalledWith("c1", "run-b");
    expect(patch).toHaveBeenCalledWith(2, "run-b", { stopping: true });
  });

  it("does nothing for a run already stopping", async () => {
    const { result } = renderHook(() =>
      useStopRuns("c1", [{ ...runs[0], stopping: true }], vi.fn()),
    );
    await act(async () => result.current.stop_run(1));
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("toolbar Stop still ends every running tab", async () => {
    const { result } = renderHook(() => useStopRuns("c1", runs, vi.fn()));
    await act(async () => result.current.stop_all());
    expect(cancelRun).toHaveBeenCalledTimes(2);
  });
});

describe("QueryLoadingOverlay", () => {
  it("shows the timer and a Stop button that calls back", async () => {
    const on_stop = vi.fn();
    render(
      <QueryLoadingOverlay startedAt={performance.now()} onStop={on_stop} />,
    );
    expect(screen.getByText(/Loading/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(on_stop).toHaveBeenCalledOnce();
  });

  it("disables Stop while the database confirms", () => {
    render(
      <QueryLoadingOverlay
        startedAt={performance.now()}
        onStop={vi.fn()}
        stopping
      />,
    );
    const button = screen.getByRole("button", { name: /Stopping/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
