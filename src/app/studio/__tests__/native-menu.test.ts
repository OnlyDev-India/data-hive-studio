import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, win, message } = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  win: {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isFullscreen: vi.fn().mockResolvedValue(false),
    setFullscreen: vi.fn().mockResolvedValue(undefined),
  },
  message: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/api/app", () => ({
  getName: vi.fn().mockResolvedValue("DH Studio"),
  getVersion: vi.fn().mockResolvedValue("1.2.3"),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message }));
vi.mock("../edit-actions", () => ({ runEditAction: vi.fn() }));

import { handleMenuAction } from "../native-menu";
import { runEditAction } from "../edit-actions";

beforeEach(() => vi.clearAllMocks());

describe("menu items only the custom title bar sends", () => {
  it("quits the whole app", () => {
    handleMenuAction("app.quit");
    expect(invoke).toHaveBeenCalledWith("quit_app");
  });

  it("toggles developer tools through the backend", () => {
    handleMenuAction("view.toggle_devtools");
    expect(invoke).toHaveBeenCalledWith("toggle_devtools_window");
  });

  it("drives the window", async () => {
    // One at a time: vitest hands the real module to a second dynamic import
    // of a mocked one that starts in the same tick.
    handleMenuAction("window.minimize");
    await vi.waitFor(() => expect(win.minimize).toHaveBeenCalled());
    handleMenuAction("window.maximize");
    await vi.waitFor(() => expect(win.toggleMaximize).toHaveBeenCalled());
    handleMenuAction("window.close");
    await vi.waitFor(() => expect(win.close).toHaveBeenCalled());
  });

  it("flips full screen from its current state", async () => {
    win.isFullscreen.mockResolvedValueOnce(true);
    handleMenuAction("view.toggle_fullscreen");
    await vi.waitFor(() =>
      expect(win.setFullscreen).toHaveBeenCalledWith(false),
    );
  });

  it("forwards edit ids to the edit helper", () => {
    handleMenuAction("edit.select_all");
    expect(runEditAction).toHaveBeenCalledWith("select_all");
  });

  it("shows the app name and version for About", async () => {
    handleMenuAction("help.about");
    await vi.waitFor(() =>
      expect(message).toHaveBeenCalledWith("DH Studio\nVersion 1.2.3", {
        title: "About DH Studio",
      }),
    );
  });
});
