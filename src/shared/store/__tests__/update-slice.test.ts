import { describe, it, expect, beforeEach } from "vitest";
import { useStudioStore } from "../store";

const store = () => useStudioStore.getState();

// The store's static type hides zustand's `persist` helpers.
const persistApi = () =>
  (useStudioStore as unknown as { persist: { rehydrate(): Promise<void> } })
    .persist;

beforeEach(() => {
  useStudioStore.setState({
    updateInfo: null,
    updatePhase: "available",
    updateProgress: null,
    updateError: null,
    updateDialogOpen: false,
  });
});

describe("update state", () => {
  it("starts with no update known, at 'available', with no error", () => {
    expect(store().updateInfo).toBeNull();
    expect(store().updatePhase).toBe("available");
    expect(store().updateProgress).toBeNull();
    expect(store().updateError).toBeNull();
  });

  it("no longer has a skipped version to hide the badge with (AC-2)", () => {
    expect(store()).not.toHaveProperty("setSkippedUpdateVersion");
  });

  describe("setUpdateInfo", () => {
    it("keeps the error when the same version is set again", () => {
      store().setUpdateInfo({ version: "2.0.0", body: null });
      store().setUpdateError("network down");

      store().setUpdateInfo({ version: "2.0.0", body: "fresh notes" });

      expect(store().updateError).toBe("network down");
    });

    it("drops the error when a different version arrives", () => {
      store().setUpdateInfo({ version: "2.0.0", body: null });
      store().setUpdateError("network down");

      store().setUpdateInfo({ version: "2.1.0", body: null });

      expect(store().updateError).toBeNull();
    });

    it("drops the error when the update is cleared", () => {
      store().setUpdateInfo({ version: "2.0.0", body: null });
      store().setUpdateError("network down");

      store().setUpdateInfo(null);

      expect(store().updateError).toBeNull();
    });

    it("does not carry an error onto the first update ever seen", () => {
      store().setUpdateError("stale");

      store().setUpdateInfo({ version: "2.0.0", body: null });

      expect(store().updateError).toBeNull();
    });
  });

  describe("persistence", () => {
    function persisted_keys(): string[] {
      const raw = localStorage.getItem("dh-studio-store");
      return Object.keys(JSON.parse(raw ?? "{}").state ?? {});
    }

    it("never saves update progress, so a relaunch starts over at 'available'", () => {
      useStudioStore.setState({
        updateInfo: { version: "2.0.0", body: "notes" },
        updatePhase: "ready",
        updateProgress: { downloaded: 1, total: 2 },
        updateError: "oops",
        updateDialogOpen: true,
      });

      const keys = persisted_keys();

      expect(keys.length).toBeGreaterThan(0);
      for (const key of [
        "updateInfo",
        "updatePhase",
        "updateProgress",
        "updateError",
        "updateDialogOpen",
        "skippedUpdateVersion",
      ]) {
        expect(keys).not.toContain(key);
      }
    });

    it("stops writing a skipped version even if an old one was stored", async () => {
      localStorage.setItem(
        "dh-studio-store",
        JSON.stringify({
          state: { skippedUpdateVersion: "2.0.0" },
          version: 0,
        }),
      );

      await persistApi().rehydrate();
      useStudioStore.setState({ showAppActivity: true });

      expect(persisted_keys()).not.toContain("skippedUpdateVersion");
    });
  });
});
