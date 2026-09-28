import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "@/shared/store";

const connectSaved = vi.fn();
vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@/features/connections", () => ({
  connectSaved: (...args: unknown[]) => connectSaved(...args),
  needsPassword: () => false,
}));

import { buildConnectionItems } from "../command-palette-items";

const shop = {
  kind: "postgres",
  host: "h",
  port: 5432,
  user: "u",
  database: "shop",
};
const logs = {
  kind: "postgres",
  host: "h",
  port: 5432,
  user: "u",
  database: "logs",
};

beforeEach(() => {
  connectSaved.mockReset();
  useStudioStore.setState({
    open: [
      { id: "a", name: "shop", kind: "postgres" },
      { id: "b", name: "scratch", kind: "sqlite" },
    ],
    activeId: "a",
    recentParams: { a: { ...shop, name: "shop" } },
    savedLocal: { shop, logs },
  } as never);
});

describe("conn: palette items", () => {
  it("lists every open connection, then the saved ones not yet open", () => {
    const items = buildConnectionItems();
    expect(items.map((i) => [i.section, i.label])).toEqual([
      ["Connected", "shop"],
      ["Connected", "scratch"],
      ["Not connected", "logs"],
    ]);
  });

  it("switches to an open connection without connecting", () => {
    const item = buildConnectionItems().find((i) => i.label === "scratch")!;
    item.run();
    expect(useStudioStore.getState().activeId).toBe("b");
    expect(useStudioStore.getState().view).toBe("workspace");
    expect(connectSaved).not.toHaveBeenCalled();
  });

  it("connects a saved connection that is not open", async () => {
    connectSaved.mockResolvedValue({ id: "c", name: "logs", kind: "postgres" });
    const item = buildConnectionItems().find((i) => i.label === "logs")!;
    expect(await item.run()).toBeUndefined();
    expect(connectSaved).toHaveBeenCalledWith("postgres", {
      ...logs,
      name: "logs",
    });
  });

  it("reports a failed connect instead of closing", async () => {
    connectSaved.mockRejectedValue("timeout");
    const item = buildConnectionItems().find((i) => i.label === "logs")!;
    expect(await item.run()).toBe("Connection failed: timeout");
  });
});
