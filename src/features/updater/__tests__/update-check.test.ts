import { describe, it, expect, beforeEach, vi } from "vitest";
import type { UpdateDownloadEvent } from "@/shared/api/updater";

const web = vi.hoisted(() => ({ WEB: false }));
const api = vi.hoisted(() => ({
  updaterDownload: vi.fn(),
  updaterInstallAndRestart: vi.fn(),
}));
const plugin = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock("@/shared/api/web", () => ({
  get WEB() {
    return web.WEB;
  },
}));
vi.mock("@/shared/api/updater", () => api);
vi.mock("@tauri-apps/plugin-updater", () => plugin);

import { useStudioStore } from "@/shared/store";
import {
  checkForUpdate,
  downloadUpdate,
  installAndRestart,
} from "../update-check";

const store = () => useStudioStore.getState();

/** A promise the test settles by hand, to observe state mid flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  web.WEB = false;
  api.updaterDownload.mockReset();
  api.updaterInstallAndRestart.mockReset();
  plugin.check.mockReset();
  useStudioStore.setState({
    updateInfo: null,
    updatePhase: "available",
    updateProgress: null,
    updateError: null,
    updateDialogOpen: false,
  });
});

describe("checkForUpdate", () => {
  it("stores the version and notes of a newer release", async () => {
    plugin.check.mockResolvedValue({
      version: "2.0.0",
      body: "## New\n- faster",
      close: vi.fn(),
    });

    await checkForUpdate();

    expect(store().updateInfo).toEqual({
      version: "2.0.0",
      body: "## New\n- faster",
    });
  });

  it("stores null notes when the release has no body", async () => {
    plugin.check.mockResolvedValue({ version: "2.0.0", close: vi.fn() });

    await checkForUpdate();

    expect(store().updateInfo).toEqual({ version: "2.0.0", body: null });
  });

  it("releases the plugin's frontend handle, since Rust does the download", async () => {
    const close = vi.fn();
    plugin.check.mockResolvedValue({ version: "2.0.0", body: null, close });

    await checkForUpdate();

    expect(close).toHaveBeenCalledOnce();
  });

  it("leaves updateInfo empty when nothing newer exists", async () => {
    plugin.check.mockResolvedValue(null);

    await checkForUpdate();

    expect(store().updateInfo).toBeNull();
  });

  it("swallows a failed check and keeps what was already known", async () => {
    useStudioStore.setState({
      updateInfo: { version: "2.0.0", body: null },
    });
    plugin.check.mockRejectedValue(new Error("offline"));

    await expect(checkForUpdate()).resolves.toBeUndefined();

    expect(store().updateInfo).toEqual({ version: "2.0.0", body: null });
  });

  it("does nothing in the web build (AC-10)", async () => {
    web.WEB = true;

    await checkForUpdate();

    expect(plugin.check).not.toHaveBeenCalled();
    expect(store().updateInfo).toBeNull();
  });

  describe("never disturbs an update that is past 'available' (AC-7)", () => {
    it.each(["downloading", "ready", "installing"] as const)(
      "skips the check entirely while %s",
      async (phase) => {
        const info = { version: "2.0.0", body: "notes" };
        useStudioStore.setState({ updateInfo: info, updatePhase: phase });
        plugin.check.mockResolvedValue({
          version: "3.0.0",
          body: "newer",
          close: vi.fn(),
        });

        await checkForUpdate();

        expect(plugin.check).not.toHaveBeenCalled();
        expect(store().updateInfo).toEqual(info);
        expect(store().updatePhase).toBe(phase);
      },
    );

    it("drops the result when Update was pressed while the check was in flight", async () => {
      const info = { version: "2.0.0", body: "notes" };
      useStudioStore.setState({ updateInfo: info });
      const inFlight = deferred<{
        version: string;
        body: string;
        close(): void;
      }>();
      plugin.check.mockReturnValue(inFlight.promise);

      const pending = checkForUpdate();
      useStudioStore.setState({ updatePhase: "downloading" });
      inFlight.resolve({ version: "3.0.0", body: "newer", close: vi.fn() });
      await pending;

      expect(store().updateInfo).toEqual(info);
      expect(store().updatePhase).toBe("downloading");
    });

    it("checks normally when no update is known, whatever phase was left behind", async () => {
      useStudioStore.setState({ updateInfo: null, updatePhase: "ready" });
      plugin.check.mockResolvedValue({
        version: "2.0.0",
        body: null,
        close: vi.fn(),
      });

      await checkForUpdate();

      expect(store().updateInfo).toEqual({ version: "2.0.0", body: null });
    });
  });
});

describe("downloadUpdate", () => {
  beforeEach(() => {
    useStudioStore.setState({
      updateInfo: { version: "2.0.0", body: "notes" },
      updatePhase: "available",
    });
  });

  it("moves to downloading, then ready with the package held by the backend (AC-3, AC-4)", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    api.updaterDownload.mockReturnValue(held.promise);

    const pending = downloadUpdate();
    expect(store().updatePhase).toBe("downloading");

    held.resolve({ version: "2.0.0", notes: "notes" });
    await pending;

    expect(store().updatePhase).toBe("ready");
    expect(store().updateProgress).toBeNull();
  });

  it("never installs or restarts by itself (AC-3)", async () => {
    api.updaterDownload.mockResolvedValue({ version: "2.0.0", notes: null });

    await downloadUpdate();

    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
  });

  it("adds up progress chunks against the announced total", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    let emit!: (e: UpdateDownloadEvent) => void;
    api.updaterDownload.mockImplementation(
      (onEvent: (e: UpdateDownloadEvent) => void) => {
        emit = onEvent;
        return held.promise;
      },
    );

    const pending = downloadUpdate();
    emit({ event: "Started", data: { contentLength: 1000 } });
    expect(store().updateProgress).toEqual({ downloaded: 0, total: 1000 });

    emit({ event: "Progress", data: { chunkLength: 250 } });
    emit({ event: "Progress", data: { chunkLength: 250 } });
    expect(store().updateProgress).toEqual({ downloaded: 500, total: 1000 });

    held.resolve({ version: "2.0.0", notes: null });
    await pending;
  });

  it("keeps the total unknown when the server sends no length", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    let emit!: (e: UpdateDownloadEvent) => void;
    api.updaterDownload.mockImplementation(
      (onEvent: (e: UpdateDownloadEvent) => void) => {
        emit = onEvent;
        return held.promise;
      },
    );

    const pending = downloadUpdate();
    emit({ event: "Started", data: { contentLength: null } });
    emit({ event: "Progress", data: { chunkLength: 40 } });

    expect(store().updateProgress).toEqual({ downloaded: 40, total: null });

    held.resolve({ version: "2.0.0", notes: null });
    await pending;
  });

  it("ignores the Finished event, since the promise settling is the real end", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    let emit!: (e: UpdateDownloadEvent) => void;
    api.updaterDownload.mockImplementation(
      (onEvent: (e: UpdateDownloadEvent) => void) => {
        emit = onEvent;
        return held.promise;
      },
    );

    const pending = downloadUpdate();
    emit({ event: "Started", data: { contentLength: 10 } });
    emit({ event: "Finished" });

    expect(store().updatePhase).toBe("downloading");
    expect(store().updateProgress).toEqual({ downloaded: 0, total: 10 });

    held.resolve({ version: "2.0.0", notes: null });
    await pending;
  });

  it("adopts the version and notes of the package actually downloaded", async () => {
    api.updaterDownload.mockResolvedValue({
      version: "2.1.0",
      notes: "newer notes",
    });

    await downloadUpdate();

    expect(store().updateInfo).toEqual({
      version: "2.1.0",
      body: "newer notes",
    });
  });

  it("returns to 'available' with the error visible when the download fails (AC-8)", async () => {
    api.updaterDownload.mockRejectedValue("network down");

    await downloadUpdate();

    expect(store().updatePhase).toBe("available");
    expect(store().updateError).toBe("network down");
    expect(store().updateProgress).toBeNull();
  });

  it("clears the old error and tries again on Retry (AC-8)", async () => {
    api.updaterDownload.mockRejectedValueOnce("network down");
    await downloadUpdate();
    expect(store().updateError).toBe("network down");

    const held = deferred<{ version: string; notes: string | null }>();
    api.updaterDownload.mockReturnValue(held.promise);
    const retry = downloadUpdate();

    expect(store().updateError).toBeNull();
    expect(store().updatePhase).toBe("downloading");

    held.resolve({ version: "2.0.0", notes: null });
    await retry;
    expect(store().updatePhase).toBe("ready");
  });

  it("does not start a second download on a double click", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    api.updaterDownload.mockReturnValue(held.promise);

    const first = downloadUpdate();
    await downloadUpdate();

    expect(api.updaterDownload).toHaveBeenCalledOnce();

    held.resolve({ version: "2.0.0", notes: null });
    await first;
  });

  it("does nothing when no update is known", async () => {
    useStudioStore.setState({ updateInfo: null });

    await downloadUpdate();

    expect(api.updaterDownload).not.toHaveBeenCalled();
    expect(store().updatePhase).toBe("available");
  });

  it("does nothing once the update is already ready", async () => {
    useStudioStore.setState({ updatePhase: "ready" });

    await downloadUpdate();

    expect(api.updaterDownload).not.toHaveBeenCalled();
    expect(store().updatePhase).toBe("ready");
  });

  it("does nothing in the web build (AC-10)", async () => {
    web.WEB = true;

    await downloadUpdate();

    expect(api.updaterDownload).not.toHaveBeenCalled();
  });

  it("keeps running after the dialog closes (AC-3)", async () => {
    const held = deferred<{ version: string; notes: string | null }>();
    api.updaterDownload.mockReturnValue(held.promise);
    useStudioStore.setState({ updateDialogOpen: true });

    const pending = downloadUpdate();
    store().setUpdateDialogOpen(false);

    expect(store().updatePhase).toBe("downloading");

    held.resolve({ version: "2.0.0", notes: null });
    await pending;
    expect(store().updatePhase).toBe("ready");
  });
});

describe("installAndRestart", () => {
  beforeEach(() => {
    useStudioStore.setState({
      updateInfo: { version: "2.0.0", body: null },
      updatePhase: "ready",
    });
  });

  it("moves to installing while the backend works (AC-5)", async () => {
    const install = deferred<void>();
    api.updaterInstallAndRestart.mockReturnValue(install.promise);

    const pending = installAndRestart();

    expect(store().updatePhase).toBe("installing");
    expect(api.updaterInstallAndRestart).toHaveBeenCalledOnce();

    install.resolve();
    await pending;
  });

  it("goes back to 'ready' with the error when the install fails (AC-8)", async () => {
    api.updaterInstallAndRestart.mockRejectedValue("permission denied");

    await installAndRestart();

    expect(store().updatePhase).toBe("ready");
    expect(store().updateError).toBe("permission denied");
  });

  it("clears the old error before a retry", async () => {
    useStudioStore.setState({ updateError: "permission denied" });
    const install = deferred<void>();
    api.updaterInstallAndRestart.mockReturnValue(install.promise);

    const pending = installAndRestart();

    expect(store().updateError).toBeNull();

    install.resolve();
    await pending;
  });

  it.each(["available", "downloading", "installing"] as const)(
    "refuses to install while %s",
    async (phase) => {
      useStudioStore.setState({ updatePhase: phase });

      await installAndRestart();

      expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
      expect(store().updatePhase).toBe(phase);
    },
  );

  it("does nothing in the web build (AC-10)", async () => {
    web.WEB = true;

    await installAndRestart();

    expect(api.updaterInstallAndRestart).not.toHaveBeenCalled();
  });
});
