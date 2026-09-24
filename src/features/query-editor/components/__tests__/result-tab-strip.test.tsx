import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Importing the editor pulls in Tauri-backed api modules; the strip itself
// touches none of them.
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { ResultTabStrip } from "../editor-tab";

afterEach(cleanup);

function strip(items: Parameters<typeof ResultTabStrip>[0]["items"]) {
  const on_toggle = vi.fn();
  render(
    <ResultTabStrip
      items={items}
      active_id={null}
      on_select={vi.fn()}
      on_close={vi.fn()}
      keep_all_tabs={false}
      on_toggle_keep_all_tabs={on_toggle}
    />,
  );
  return { on_toggle };
}

describe("ResultTabStrip", () => {
  it("still shows the strip, with its toggle, before any result exists", async () => {
    const { on_toggle } = strip([]);

    await userEvent.click(
      screen.getByRole("button", { name: "New tab per run: off" }),
    );

    expect(on_toggle).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("Close result tab")).toBeNull();
  });

  it("shows one pill per result next to the toggle", () => {
    strip([{ id: 1, label: "users", running: false, has_error: false }]);

    expect(screen.getByText("users")).toBeTruthy();
    expect(screen.getByLabelText("New tab per run: off")).toBeTruthy();
  });

  it("hides the results panel from the chevron, only when given a handler", async () => {
    const on_hide = vi.fn();
    const { rerender } = render(
      <ResultTabStrip
        items={[]}
        active_id={null}
        on_select={vi.fn()}
        on_close={vi.fn()}
        keep_all_tabs={false}
        on_toggle_keep_all_tabs={vi.fn()}
        on_hide={on_hide}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Hide results panel" }),
    );
    expect(on_hide).toHaveBeenCalledOnce();

    rerender(
      <ResultTabStrip
        items={[]}
        active_id={null}
        on_select={vi.fn()}
        on_close={vi.fn()}
        keep_all_tabs={false}
        on_toggle_keep_all_tabs={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Hide results panel")).toBeNull();
  });
});
