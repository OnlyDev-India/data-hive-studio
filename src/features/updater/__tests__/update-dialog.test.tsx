import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UpdateDownloadEvent } from "@/shared/api/updater";

const api = vi.hoisted(() => ({
  updaterDownload: vi.fn(),
  updaterInstallAndRestart: vi.fn(),
}));
const plugin = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock("@/shared/api/web", () => ({ WEB: false }));
// Store changes schedule a debounced workspace save; keep it off Tauri IPC.
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/shared/api/updater", () => api);
vi.mock("@tauri-apps/plugin-updater", () => plugin);
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("1.0.0"),
}));

import { tabKey, useStudioStore, type StudioTab } from "@/shared/store";
import { UpdateDialog } from "../update-dialog";

const store = () => useStudioStore.getState();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Puts the store where the badge would have left it, dialog open. */
function openWith(
  phase: "available" | "downloading" | "ready" | "installing",
  extra: Partial<ReturnType<typeof store>> = {},
) {
  useStudioStore.setState({
    updateInfo: { version: "2.0.0", body: "Notes for **2.0.0**" },
    updatePhase: phase,
    updateDialogOpen: true,
    ...extra,
  });
}

/** One open table tab that holds staged row edits. */
function stageRowEdits(count: number) {
  const tab: StudioTab = { kind: "table", name: "users", tabId: 1 };
  useStudioStore.setState({
    workspaces: { c1: { tabs: [tab] } } as never,
    gridBridges: {
      [tabKey(tab)]: { pending_exists: true, pending_count: count },
    } as never,
  });
}

beforeEach(() => {
  api.updaterDownload.mockReset();
  api.updaterInstallAndRestart.mockReset();
  plugin.check.mockReset();
  useStudioStore.setState({
    updateInfo: null,
    updatePhase: "available",
    updateProgress: null,
    updateError: null,
    updateDialogOpen: false,
    workspaces: {},
    gridBridges: {},
    schemaEdits: {},
    newTables: {},
  });
});

describe("available", () => {
  it("offers Update and Later, and no Skip (AC-2)", async () => {
    openWith("available");
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("heading", { name: "Update available" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /skip/i })).toBeNull();
  });

  it("names the new version and the one you have", async () => {
    openWith("available");
    render(<UpdateDialog />);

    expect(
      await screen.findByText("Version 2.0.0 (you have 1.0.0) is available."),
    ).toBeVisible();
  });

  it("shows the release notes as formatted markdown (AC-1)", async () => {
    openWith("available", {
      updateInfo: {
        version: "2.0.0",
        body: "## What's new\n\n- **Faster** grid\n- `bun` support",
      },
    });
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "What's new" }),
    ).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Faster").tagName).toBe("STRONG");
    expect(screen.queryByText(/\*\*Faster\*\*/)).toBeNull();
  });

  it("shows no notes box when the release has no notes", async () => {
    openWith("available", { updateInfo: { version: "2.0.0", body: null } });
    render(<UpdateDialog />);

    await screen.findByRole("heading", { name: "Update available" });
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("closes on Later without hiding the update (AC-2)", async () => {
    const user = userEvent.setup();
    openWith("available");
    render(<UpdateDialog />);

    await user.click(await screen.findByRole("button", { name: "Later" }));

    expect(store().updateDialogOpen).toBe(false);
    expect(store().updateInfo).toEqual({
      version: "2.0.0",
      body: "Notes for **2.0.0**",
    });
    expect(store().updatePhase).toBe("available");
  });

  it("closes on Escape without hiding the update (AC-2)", async () => {
    const user = userEvent.setup();
    openWith("available");
    render(<UpdateDialog />);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(store().updateDialogOpen).toBe(false);
    expect(store().updateInfo).not.toBeNull();
  });
});

describe("downloading", () => {
  it("Update only downloads: it never installs or restarts (AC-3)", async () => {
    const user = userEvent.setup();
    const held = deferred<{ version: string; notes: string | null }>();
    api.updaterDownload.mockReturnValue(held.promise);
    openWith("available");
    render(<UpdateDialog />);

    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(api.updaterDownload).toHaveBeenCalledOnce();
    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("heading", { name: "Downloading update" }),
    ).toBeVisible();

    held.resolve({ version: "2.0.0", notes: null });
    await waitFor(() => expect(store().updatePhase).toBe("ready"));
    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
  });

  it("disables the button and shows the percent while downloading", async () => {
    openWith("downloading", {
      updateProgress: { downloaded: 250, total: 1000 },
    });
    render(<UpdateDialog />);

    expect(await screen.findByText("25%")).toBeVisible();
    expect(screen.getByRole("button", { name: "Downloading…" })).toBeDisabled();
  });

  it("shows a plain 'Downloading…' when the total size is unknown", async () => {
    openWith("downloading", {
      updateProgress: { downloaded: 250, total: null },
    });
    render(<UpdateDialog />);

    // The button also says "Downloading…"; the progress line is the <p>.
    const line = await screen.findByText("Downloading…", { selector: "p" });
    expect(line).toBeVisible();
  });

  it("caps the percent at 100", async () => {
    openWith("downloading", {
      updateProgress: { downloaded: 1200, total: 1000 },
    });
    render(<UpdateDialog />);

    expect(await screen.findByText("100%")).toBeVisible();
  });

  it("keeps downloading when Later closes the popup (AC-3)", async () => {
    const user = userEvent.setup();
    const held = deferred<{ version: string; notes: string | null }>();
    let emit!: (e: UpdateDownloadEvent) => void;
    api.updaterDownload.mockImplementation(
      (onEvent: (e: UpdateDownloadEvent) => void) => {
        emit = onEvent;
        return held.promise;
      },
    );
    openWith("available");
    render(<UpdateDialog />);
    await user.click(await screen.findByRole("button", { name: "Update" }));

    await user.click(await screen.findByRole("button", { name: "Later" }));
    act(() => {
      emit({ event: "Started", data: { contentLength: 100 } });
      emit({ event: "Progress", data: { chunkLength: 60 } });
    });

    expect(store().updateDialogOpen).toBe(false);
    expect(store().updatePhase).toBe("downloading");
    expect(store().updateProgress).toEqual({ downloaded: 60, total: 100 });

    held.resolve({ version: "2.0.0", notes: null });
    await waitFor(() => expect(store().updatePhase).toBe("ready"));
  });
});

describe("ready", () => {
  it("lands on the Restart step when opened after the download finished (AC-4)", async () => {
    openWith("ready");
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("heading", { name: "Update ready to install" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Restart now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("explains that closing the app also installs it (AC-6)", async () => {
    openWith("ready");
    render(<UpdateDialog />);

    expect(
      await screen.findByText(/closing the app also installs it/i),
    ).toBeVisible();
  });

  it("does not restart on its own when the download completes (AC-4)", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    api.updaterDownload.mockReturnValue(held.promise);
    const user = userEvent.setup();
    openWith("available");
    render(<UpdateDialog />);
    await user.click(await screen.findByRole("button", { name: "Update" }));

    held.resolve({ version: "2.0.0", notes: null });

    expect(
      await screen.findByRole("button", { name: "Restart now" }),
    ).toBeVisible();
    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
  });

  it("leaves the update ready when Later is pressed", async () => {
    const user = userEvent.setup();
    openWith("ready");
    render(<UpdateDialog />);

    await user.click(await screen.findByRole("button", { name: "Later" }));

    expect(store().updateDialogOpen).toBe(false);
    expect(store().updatePhase).toBe("ready");
  });
});

describe("Restart now (AC-5)", () => {
  it("installs straight away when no tab has unapplied work", async () => {
    const user = userEvent.setup();
    api.updaterInstallAndRestart.mockReturnValue(new Promise(() => {}));
    openWith("ready");
    render(<UpdateDialog />);

    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );

    expect(api.updaterInstallAndRestart).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("heading", { name: "Installing update…" }),
    ).toBeVisible();
  });

  it("does not ask when the only dirty thing is unsaved SQL text", async () => {
    const user = userEvent.setup();
    api.updaterInstallAndRestart.mockReturnValue(new Promise(() => {}));
    const tab: StudioTab = { kind: "sql", id: 0 };
    useStudioStore.setState({
      workspaces: { c1: { tabs: [tab] } } as never,
      sqlTabs: { [tabKey(tab)]: { is_dirty: true } } as never,
    });
    openWith("ready");
    render(<UpdateDialog />);

    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );

    expect(api.updaterInstallAndRestart).toHaveBeenCalledOnce();
  });

  it("lists what would be lost and waits for confirmation", async () => {
    const user = userEvent.setup();
    stageRowEdits(3);
    openWith("ready");
    render(<UpdateDialog />);

    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Restart with unsaved changes?",
      }),
    ).toBeVisible();
    expect(screen.getByText("users")).toBeVisible();
    expect(screen.getByText("3 unsaved row edits")).toBeVisible();
    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
  });

  it("keeps the update ready when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    stageRowEdits(1);
    openWith("ready");
    render(<UpdateDialog />);
    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(
      await screen.findByRole("heading", { name: "Update ready to install" }),
    ).toBeVisible();
    expect(store().updatePhase).toBe("ready");
    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
  });

  it("installs after 'Restart anyway'", async () => {
    const user = userEvent.setup();
    api.updaterInstallAndRestart.mockReturnValue(new Promise(() => {}));
    stageRowEdits(1);
    openWith("ready");
    render(<UpdateDialog />);
    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Restart anyway" }),
    );

    expect(api.updaterInstallAndRestart).toHaveBeenCalledOnce();
  });

  it("forgets the confirmation when the popup is closed and reopened", async () => {
    const user = userEvent.setup();
    stageRowEdits(1);
    openWith("ready");
    render(<UpdateDialog />);
    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );
    await screen.findByRole("heading", {
      name: "Restart with unsaved changes?",
    });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => useStudioStore.setState({ updateDialogOpen: true }));

    expect(
      await screen.findByRole("heading", { name: "Update ready to install" }),
    ).toBeVisible();
  });
});

describe("installing", () => {
  it("disables Later and refuses to close while the install runs", async () => {
    const user = userEvent.setup();
    openWith("installing");
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("button", { name: "Installing…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(store().updateDialogOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("failures (AC-8)", () => {
  it("shows a failed download with a Retry button that downloads again", async () => {
    const user = userEvent.setup();
    api.updaterDownload.mockRejectedValueOnce("network down");
    openWith("available");
    render(<UpdateDialog />);
    await user.click(await screen.findByRole("button", { name: "Update" }));

    expect(await screen.findByText("network down")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Update available" }),
    ).toBeVisible();

    api.updaterDownload.mockResolvedValueOnce({
      version: "2.0.0",
      notes: null,
    });
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(store().updatePhase).toBe("ready"));
    expect(api.updaterDownload).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("network down")).toBeNull();
  });

  it("shows a failed install on the ready step with a Retry button", async () => {
    const user = userEvent.setup();
    api.updaterInstallAndRestart.mockRejectedValueOnce("permission denied");
    openWith("ready");
    render(<UpdateDialog />);
    await user.click(
      await screen.findByRole("button", { name: "Restart now" }),
    );

    expect(await screen.findByText("permission denied")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Update ready to install" }),
    ).toBeVisible();

    api.updaterInstallAndRestart.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(api.updaterInstallAndRestart).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(store().updatePhase).toBe("installing"));
  });
});

describe("Help menu check (AC-11)", () => {
  it("says 'You're up to date' when nothing newer exists", async () => {
    const user = userEvent.setup();
    plugin.check.mockResolvedValue(null);
    useStudioStore.setState({ updateDialogOpen: true });
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("heading", { name: "You're up to date" }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();

    // The corner X and the footer button are both named "Close".
    const [close] = screen.getAllByRole("button", { name: "Close" });
    await user.click(close);
    expect(store().updateDialogOpen).toBe(false);
  });

  it("shows a checking state while the check runs", async () => {
    const inFlight = deferred<null>();
    plugin.check.mockReturnValue(inFlight.promise);
    useStudioStore.setState({ updateDialogOpen: true });
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("heading", { name: "Checking for updates…" }),
    ).toBeVisible();

    inFlight.resolve(null);
    expect(
      await screen.findByRole("heading", { name: "You're up to date" }),
    ).toBeVisible();
  });

  it("goes to the update when the check finds one", async () => {
    plugin.check.mockResolvedValue({
      version: "2.0.0",
      body: "Fresh notes",
      close: vi.fn(),
    });
    useStudioStore.setState({ updateDialogOpen: true });
    render(<UpdateDialog />);

    expect(
      await screen.findByRole("heading", { name: "Update available" }),
    ).toBeVisible();
    expect(screen.getByText("Fresh notes")).toBeVisible();
  });

  it("does not run a check when opened from the badge with an update known", async () => {
    openWith("ready");
    render(<UpdateDialog />);
    await screen.findByRole("dialog");

    expect(plugin.check).not.toHaveBeenCalled();
  });
});

describe("accessibility", () => {
  it("is a dialog with a title and an accessible description", async () => {
    openWith("available");
    render(<UpdateDialog />);

    const dialog = await screen.findByRole("dialog", {
      name: "Update available",
    });

    expect(dialog).toHaveAccessibleDescription(/is available/);
  });

  it("puts every action in reach of the keyboard", async () => {
    const user = userEvent.setup();
    openWith("ready");
    render(<UpdateDialog />);
    const dialog = await screen.findByRole("dialog");
    // The dialog moves focus in after it mounts; wait for that before tabbing
    // so the walk always starts from the same place.
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );

    const seen = new Set<string>([document.activeElement?.textContent ?? ""]);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      seen.add(document.activeElement?.textContent ?? "");
    }

    expect(seen).toContain("Later");
    expect(seen).toContain("Restart now");
  });
});
