import { describe, expect, it, vi } from "vitest";

// A hand-held Studio chunk: the mocked module only resolves once `release`
// is called, standing in for a chunk that is still downloading.
const studioChunk = vi.hoisted(() => {
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => (release = resolve));
  return { loaded, release };
});

vi.mock("@/app/studio/studio", async () => {
  await studioChunk.loaded;
  return { Studio: () => null };
});
vi.mock("@/shared/api/web", () => ({ WEB: true }));
vi.mock("@/shared/store", () => ({
  bootstrapWorkspaceRestore: vi.fn().mockResolvedValue(undefined),
  useStudioStore: {
    getState: () => ({
      hydrateSavedLocal: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));
vi.mock("@/features/updater", () => ({ checkForUpdate: vi.fn() }));

import { runStartupBootstrap } from "../bootstrap";

describe("runStartupBootstrap", () => {
  it("keeps the splash up until the Studio chunk has loaded", async () => {
    let settled = false;
    const bootstrap = runStartupBootstrap().then(() => {
      settled = true;
    });

    // Everything else (saved connections, workspace restore) is instant, so
    // only the pending chunk can be what holds the splash here. Lifting it
    // early is what left a blank screen between the splash and the home page.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);

    studioChunk.release();
    await bootstrap;
    expect(settled).toBe(true);
  });
});
