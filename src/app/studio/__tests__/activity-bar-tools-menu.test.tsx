import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityBar } from "../activity-bar";

afterEach(cleanup);

describe("activity bar tools menu", () => {
  it("opens with its Tools label without crashing", async () => {
    render(
      <ActivityBar
        home_active={false}
        tables_active={false}
        activity_active={false}
        conn_id="c1"
        on_home={() => {}}
        on_tables={() => {}}
        on_new_table={() => {}}
        on_sql={() => {}}
        on_activity={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "More tools" }));
    expect(await screen.findByText("Tools")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Compare tables/ }),
    ).toBeTruthy();
  });
});
