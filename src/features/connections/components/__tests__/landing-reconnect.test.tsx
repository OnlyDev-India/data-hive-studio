import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { connectPostgres, closeConnection, updateLocalConnection } = vi.hoisted(
  () => ({
    connectPostgres: vi.fn(),
    closeConnection: vi.fn(),
    updateLocalConnection: vi.fn(),
  }),
);

vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  connectPostgres,
  closeConnection,
}));
vi.mock("@/shared/api/local-connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/local-connections")>()),
  updateLocalConnection,
}));

import { useStudioStore } from "@/shared/store";
import type { SavedConnParams } from "@/shared/store";
import { Landing } from "../landing";

const saved: SavedConnParams = {
  kind: "postgres",
  name: "Orders",
  host: "db.example",
  port: 5432,
  user: "app",
  password: "pw",
  database: "orders",
};
const live = { id: "live1", name: "orders", kind: "postgres" as const };

function editOrders() {
  useStudioStore.setState({
    landingPrefill: {
      kind: "postgres",
      params: saved,
      n: 1,
      connect: false,
      edit: { oldName: "Orders", name: "Orders" },
    },
  });
}

beforeEach(() => {
  connectPostgres
    .mockReset()
    .mockResolvedValue({ id: "fresh", name: "orders", kind: "postgres" });
  closeConnection.mockReset().mockResolvedValue(undefined);
  updateLocalConnection
    .mockReset()
    .mockImplementation(async (_old, input) => input);
  useStudioStore.setState({
    savedLocal: { Orders: saved },
    open: [live],
    activeId: "live1",
    recentParams: { live1: { ...saved, name: "Orders" } },
    workspaces: {},
    landingPrefill: null,
  });
});
afterEach(cleanup);

async function loadFormAndTurnOnReadOnly() {
  editOrders();
  render(<Landing />);
  await screen.findByDisplayValue("db.example");
  await userEvent.click(screen.getByRole("switch", { name: /read only/i }));
}

describe("Landing, editing a saved connection that is open", () => {
  it("saves a local PostgreSQL edit with the Update button", async () => {
    await loadFormAndTurnOnReadOnly();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(updateLocalConnection).toHaveBeenCalledOnce());
    expect(updateLocalConnection.mock.calls[0][0]).toBe("Orders");
    expect(updateLocalConnection.mock.calls[0][1]).toMatchObject({
      read_only: true,
    });
  });

  it("offers Reconnect now when the open connection no longer matches", async () => {
    await loadFormAndTurnOnReadOnly();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(/reconnect to apply/i);
    // The old settings hold: nothing was closed or reopened yet.
    expect(closeConnection).not.toHaveBeenCalled();
    expect(connectPostgres).not.toHaveBeenCalled();
    expect(useStudioStore.getState().open).toEqual([live]);
  });

  it("Later leaves the open connection exactly as it was", async () => {
    await loadFormAndTurnOnReadOnly();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /later/i }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(closeConnection).not.toHaveBeenCalled();
    expect(connectPostgres).not.toHaveBeenCalled();
    expect(useStudioStore.getState().open).toEqual([live]);
  });

  it("Reconnect now closes the old connection and connects with the new flag", async () => {
    await loadFormAndTurnOnReadOnly();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /reconnect now/i }),
    );

    await waitFor(() => expect(connectPostgres).toHaveBeenCalledOnce());
    expect(closeConnection).toHaveBeenCalledWith("live1");
    expect(connectPostgres.mock.calls[0][0]).toMatchObject({
      host: "db.example",
      read_only: true,
    });
    await waitFor(() =>
      expect(useStudioStore.getState().open.map((c) => c.id)).toEqual([
        "fresh",
      ]),
    );
  });

  it("does not offer it when nothing about the guard changed", async () => {
    editOrders();
    render(<Landing />);
    await screen.findByDisplayValue("db.example");
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(updateLocalConnection).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not offer it when the connection is not open", async () => {
    useStudioStore.setState({ open: [], recentParams: {} });
    await loadFormAndTurnOnReadOnly();
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(updateLocalConnection).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
