import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openDatabasePath } = vi.hoisted(() => ({ openDatabasePath: vi.fn() }));

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  openDatabasePath,
}));

import { useStudioStore } from "@/shared/store";
import { reopenRecent } from "../reopen";

const file = {
  id: "old",
  name: "app.db",
  kind: "sqlite" as const,
  source_path: "/d/app.db",
};

beforeEach(() => {
  openDatabasePath.mockReset().mockImplementation(async (_path, guard) => ({
    ...file,
    id: "fresh",
    ...guard,
  }));
  useStudioStore.setState({ open: [] });
});
afterEach(() => vi.clearAllMocks());

const opened = () => useStudioStore.getState().open;

describe("reopenRecent", () => {
  it("reopens a read only file read only, so a restart never unlocks it", async () => {
    await reopenRecent({ ...file, read_only: true });

    expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db", {
      read_only: true,
    });
    expect(opened()[0]).toMatchObject({ id: "fresh", read_only: true });
  });

  it("carries the label with the lock", async () => {
    await reopenRecent({
      ...file,
      read_only: true,
      env_label: "Production",
      confirm_writes: true,
    });

    expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db", {
      read_only: true,
      env_label: "Production",
      confirm_writes: true,
    });
  });

  it("reopens a file from before read only existed exactly as before", async () => {
    await reopenRecent(file);

    expect(openDatabasePath.mock.calls[0]).toEqual(["/d/app.db"]);
  });

  it("just activates a connection that is still open", async () => {
    useStudioStore.setState({ open: [file] });

    await reopenRecent(file);

    expect(openDatabasePath).not.toHaveBeenCalled();
  });
});
