import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useStudioStore } from "@/shared/store";

vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  // The table list never arrives, like a slow remote database.
  listTables: () => new Promise(() => {}),
}));

import Workspace from "../workspace";

const conn = { id: "c1", name: "shop", kind: "postgres" } as const;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe("workspace after connecting", () => {
  it("shows the tab area before the table list has loaded", () => {
    useStudioStore.setState({ open: [conn], activeId: conn.id } as never);
    render(
      <Workspace
        conn={conn}
        landing={false}
        on_home={() => {}}
        on_tables={() => {}}
        on_activity={() => {}}
      />,
    );
    expect(
      screen.getAllByRole("button", { name: "Open a new SQL editor" }).length,
    ).toBeGreaterThan(0);
  });
});
