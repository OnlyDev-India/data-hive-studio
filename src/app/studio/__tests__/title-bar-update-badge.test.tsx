import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `IS_MAC` is read once when title-bar.tsx loads, so the user agent has to
// say "Mac" before the import below runs. The macOS bar is the simplest to
// render: it needs no native window API.
vi.hoisted(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
    configurable: true,
  });
});
vi.mock("@/shared/api/web", () => ({ WEB: false }));
// Store changes schedule a debounced workspace save; keep it off Tauri IPC.
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@/shared/api/updater", () => ({
  updaterDownload: vi.fn(),
  updaterInstallAndRestart: vi.fn(),
}));

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStudioStore } from "@/shared/store";
import { TitleBar } from "../title-bar";

const CALLOUT_MS = 8000;

// The store's static type hides zustand's `persist` helpers.
const persistApi = () =>
  (useStudioStore as unknown as { persist: { rehydrate(): Promise<void> } })
    .persist;

function badge() {
  return screen.queryByRole("button", { name: /update/i });
}

function reset() {
  useStudioStore.setState({
    updateInfo: null,
    updatePhase: "available",
    updateProgress: null,
    updateError: null,
    updateDialogOpen: false,
    open: [],
    view: "home",
  });
}

beforeEach(reset);
afterEach(() => {
  vi.useRealTimers();
});

describe("update badge", () => {
  it("is absent until an update is known", () => {
    render(<TitleBar />);

    expect(badge()).toBeNull();
  });

  it("appears once an update is known, naming the version", () => {
    useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
    render(<TitleBar />);

    expect(
      screen.getByRole("button", { name: "Update available — v2.0.0" }),
    ).toBeVisible();
  });

  it("stays visible after the popup is dismissed with Later (AC-2)", () => {
    useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
    render(<TitleBar />);

    act(() => {
      useStudioStore.getState().setUpdateDialogOpen(true);
      useStudioStore.getState().setUpdateDialogOpen(false);
    });

    expect(badge()).not.toBeNull();
  });

  it("shows even when an old build stored a skipped version for this release (AC-2)", async () => {
    localStorage.setItem(
      "dh-studio-store",
      JSON.stringify({ state: { skippedUpdateVersion: "2.0.0" }, version: 0 }),
    );
    await persistApi().rehydrate();
    useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });

    render(<TitleBar />);

    expect(badge()).not.toBeNull();
  });

  it("opens the update popup when clicked, in any phase (AC-4)", async () => {
    const user = userEvent.setup();
    useStudioStore.setState({
      updateInfo: { version: "2.0.0", body: null },
      updatePhase: "ready",
    });
    render(<TitleBar />);

    await user.click(badge()!);

    expect(useStudioStore.getState().updateDialogOpen).toBe(true);
    // The badge does not change the phase, so the popup lands on Restart.
    expect(useStudioStore.getState().updatePhase).toBe("ready");
  });

  describe("phases", () => {
    it("shows the percent while downloading", () => {
      useStudioStore.setState({
        updateInfo: { version: "2.0.0", body: null },
        updatePhase: "downloading",
        updateProgress: { downloaded: 300, total: 1000 },
      });
      render(<TitleBar />);

      expect(
        screen.getByRole("button", {
          name: "Downloading update — v2.0.0 (30%)",
        }),
      ).toBeVisible();
    });

    it("leaves the percent out while the total size is unknown", () => {
      useStudioStore.setState({
        updateInfo: { version: "2.0.0", body: null },
        updatePhase: "downloading",
        updateProgress: { downloaded: 300, total: null },
      });
      render(<TitleBar />);

      expect(
        screen.getByRole("button", { name: "Downloading update — v2.0.0" }),
      ).toBeVisible();
    });

    it("turns into a distinct ready state once downloaded (AC-4)", () => {
      useStudioStore.setState({
        updateInfo: { version: "2.0.0", body: null },
        updatePhase: "ready",
      });
      render(<TitleBar />);

      expect(
        screen.getByRole("button", {
          name: "Update ready, restart to install — v2.0.0",
        }),
      ).toBeVisible();
    });

    it("says it is installing during the install", () => {
      useStudioStore.setState({
        updateInfo: { version: "2.0.0", body: null },
        updatePhase: "installing",
      });
      render(<TitleBar />);

      expect(
        screen.getByRole("button", { name: "Installing update — v2.0.0" }),
      ).toBeVisible();
    });

    it("follows the store from available to ready without remounting", () => {
      useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
      render(<TitleBar />);
      expect(badge()).toHaveAccessibleName("Update available — v2.0.0");

      act(() => useStudioStore.getState().setUpdatePhase("downloading"));
      expect(badge()).toHaveAccessibleName("Downloading update — v2.0.0");

      act(() => useStudioStore.getState().setUpdatePhase("ready"));
      expect(badge()).toHaveAccessibleName(
        "Update ready, restart to install — v2.0.0",
      );
    });
  });

  describe("callout (AC-11)", () => {
    // The tooltip popup has no ARIA role of its own, so it is found by the
    // slot the shared `TooltipContent` stamps on it.
    const callout = () =>
      document.querySelector('[data-slot="tooltip-content"]');

    it("opens on its own for a newly seen version, then dismisses after 8 seconds", () => {
      vi.useFakeTimers();
      useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });

      render(<TitleBar />);
      expect(callout()).toHaveTextContent("Update available — v2.0.0");

      act(() => vi.advanceTimersByTime(CALLOUT_MS - 1));
      expect(callout()).not.toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(callout()).toBeNull();
    });

    it("does not reopen for the same version when it is only re-set", () => {
      vi.useFakeTimers();
      useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
      render(<TitleBar />);
      act(() => vi.advanceTimersByTime(CALLOUT_MS));
      expect(callout()).toBeNull();

      act(() =>
        useStudioStore
          .getState()
          .setUpdateInfo({ version: "2.0.0", body: "edited notes" }),
      );

      expect(callout()).toBeNull();
    });

    it("does not reopen when the download starts", () => {
      vi.useFakeTimers();
      useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
      render(<TitleBar />);
      act(() => vi.advanceTimersByTime(CALLOUT_MS));

      act(() => useStudioStore.getState().setUpdatePhase("downloading"));

      expect(callout()).toBeNull();
    });

    it("opens once more when the download becomes ready", () => {
      vi.useFakeTimers();
      useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
      render(<TitleBar />);
      act(() => vi.advanceTimersByTime(CALLOUT_MS));
      act(() => useStudioStore.getState().setUpdatePhase("downloading"));

      act(() => useStudioStore.getState().setUpdatePhase("ready"));

      expect(callout()).toHaveTextContent(
        "Update ready, restart to install — v2.0.0",
      );
    });

    it("opens again for a newer version", () => {
      vi.useFakeTimers();
      useStudioStore.setState({ updateInfo: { version: "2.0.0", body: null } });
      render(<TitleBar />);
      act(() => vi.advanceTimersByTime(CALLOUT_MS));

      act(() =>
        useStudioStore
          .getState()
          .setUpdateInfo({ version: "2.1.0", body: null }),
      );

      expect(callout()).toHaveTextContent("Update available — v2.1.0");
    });
  });
});
