import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SecretStoreNotice } from "../../api/local-connections";

const api = vi.hoisted(() => ({
  listLocalConnections: vi.fn(),
  getLocalConnectionSecret: vi.fn(),
  takeSecretStoreNotice: vi.fn(),
}));
vi.mock("@/shared/api/local-connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/local-connections")>()),
  ...api,
}));
vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/web")>()),
  WEB: false,
}));

import { useStudioStore } from "../store";

const meta = {
  name: "prod",
  kind: "postgres",
  host: "h",
  port: 5432,
  user: "u",
  database: "d",
};

async function hydrateWith(notice: SecretStoreNotice | null) {
  api.takeSecretStoreNotice.mockResolvedValue(notice);
  await useStudioStore.getState().hydrateSavedLocal();
  return useStudioStore.getState().notifications;
}

describe("hydrateSavedLocal secret store notice", () => {
  beforeEach(() => {
    useStudioStore.setState({ notifications: [], savedLocal: {} });
    api.listLocalConnections.mockResolvedValue([meta]);
    api.getLocalConnectionSecret.mockRejectedValue(
      "no stored password for this connection",
    );
  });

  it("shows nothing when there is no notice", async () => {
    expect(await hydrateWith(null)).toHaveLength(0);
    expect(useStudioStore.getState().savedLocal.prod.secret_missing).toBe(true);
  });

  it("explains a key reset", async () => {
    const [n, ...rest] = await hydrateWith({ kind: "key_reset", names: [] });
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({
      kind: "error",
      title: "Saved passwords were cleared",
    });
    expect(n.detail).toContain("Your connections are kept");
  });

  it("names the passwords that weren't carried over", async () => {
    const [n, ...rest] = await hydrateWith({
      kind: "import_partial",
      names: ["prod", "stage"],
    });
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({
      kind: "error",
      title: "Some passwords weren't carried over",
      detail:
        "Couldn't read 2 saved passwords from the Keychain: prod, stage. You'll be asked for them when you connect.",
    });
  });

  it("says a newer version made the passwords", async () => {
    const [n, ...rest] = await hydrateWith({
      kind: "newer_version",
      names: [],
    });
    expect(rest).toHaveLength(0);
    expect(n).toMatchObject({
      kind: "error",
      title: "Saved passwords unavailable",
      detail:
        "Saved passwords were made by a newer version of DH Studio. Update the app to save passwords.",
    });
  });
});
