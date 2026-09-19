import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SqlitePanel } from "../sqlite-panel";

afterEach(cleanup);

function panel(overrides: Partial<Parameters<typeof SqlitePanel>[0]> = {}) {
  const props = {
    path: null as string | null,
    name: "",
    setName: vi.fn(),
    opening: false,
    onBrowse: vi.fn(),
    onOpen: vi.fn(),
    editing: false,
    onSaveLocal: vi.fn(),
    onCancelEdit: vi.fn(),
    ...overrides,
  };
  render(<SqlitePanel {...props} />);
  return props;
}

describe("SqlitePanel", () => {
  it("offers Save, but only once a file is chosen", async () => {
    const empty = panel();
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(empty.onSaveLocal).not.toHaveBeenCalled();
    cleanup();

    const chosen = panel({ path: "/data/app.db" });
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(chosen.onSaveLocal).toHaveBeenCalledOnce();
  });

  it("choosing a file only picks it, opening is a separate step", async () => {
    const p = panel({ path: "/data/app.db" });

    await userEvent.click(screen.getByRole("button", { name: /browse/i }));
    expect(p.onBrowse).toHaveBeenCalledOnce();
    expect(p.onOpen).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(p.onOpen).toHaveBeenCalledOnce();
  });

  it("cannot open before a file is chosen", () => {
    panel();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
  });

  it("swaps Save for Update and Cancel while editing a saved connection", async () => {
    const p = panel({ path: "/data/app.db", editing: true });

    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(p.onSaveLocal).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onCancelEdit).toHaveBeenCalledOnce();
  });

  it("lets you name the connection", async () => {
    const p = panel({ path: "/data/app.db" });
    await userEvent.type(screen.getByPlaceholderText(/connection name/i), "x");
    expect(p.setName).toHaveBeenCalledWith("x");
  });
});
