import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriCore } from "@/test/mock-tauri";

const { connectPostgres, flags } = vi.hoisted(() => ({
  connectPostgres: vi.fn(),
  flags: { web: false },
}));

vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/web")>()),
  get WEB() {
    return flags.web;
  },
}));
vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  connectPostgres,
}));

import { useStudioStore, type SavedConnParams } from "@/shared/store";
import { HomeView } from "../home-view";

const orders: SavedConnParams = {
  kind: "postgres",
  name: "Orders",
  host: "db.example",
  port: 5432,
  user: "app",
  password: "pw",
  database: "orders",
};

beforeEach(() => {
  flags.web = false;
  connectPostgres
    .mockReset()
    .mockResolvedValue({ id: "p1", name: "orders", kind: "postgres" });
  useStudioStore.setState({
    savedLocal: { Orders: orders },
    open: [],
    pins: [],
    recent: [],
    recentParams: {},
    landingForm: null,
  });
});
afterEach(cleanup);

const row = () =>
  screen.getByRole("button", { name: /orders/i, pressed: false });

function renderView() {
  render(<HomeView search_value="" on_search_change={() => {}} />);
}

describe("HomeView saved rows", () => {
  it("selects on a single click without touching the form", async () => {
    renderView();
    await userEvent.click(row());
    expect(
      screen.getByRole("button", { name: /orders/i, pressed: true }),
    ).toBeInTheDocument();
    expect(useStudioStore.getState().landingForm).toBeNull();
    expect(connectPostgres).not.toHaveBeenCalled();
  });

  it("connects directly on a double click", async () => {
    renderView();
    await userEvent.dblClick(row());
    await waitFor(() => expect(connectPostgres).toHaveBeenCalled());
    expect(connectPostgres.mock.calls[0][0]).toMatchObject({
      host: "db.example",
      password: "pw",
      database: "orders",
    });
    expect(useStudioStore.getState().landingForm).toBeNull();
  });

  it("fills the bar before the workspace opens", async () => {
    let finish!: (v: unknown) => void;
    connectPostgres.mockReturnValue(new Promise((r) => (finish = r)));
    renderView();
    await userEvent.dblClick(row());

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Connecting to Orders");
    expect(dialog).toHaveTextContent("db.example:5432");
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    expect(connectPostgres).toHaveBeenCalledOnce();

    finish({ id: "p1", name: "orders", kind: "postgres" });
    expect(await screen.findByText("Connected to Orders")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(useStudioStore.getState().open).toEqual([]);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useStudioStore.getState().open.map((c) => c.id)).toEqual(["p1"]);
  });

  it("connects on Enter", async () => {
    renderView();
    row().focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(connectPostgres).toHaveBeenCalledOnce());
  });

  it("shows a toast and leaves the form alone when connecting fails", async () => {
    connectPostgres.mockRejectedValue("refused");
    renderView();
    await userEvent.dblClick(row());
    await waitFor(() =>
      expect(
        useStudioStore
          .getState()
          .notifications.some((n) => n.title === "Connection failed"),
      ).toBe(true),
    );
    expect(useStudioStore.getState().landingForm).toBeNull();
  });
});

describe("HomeView on the web", () => {
  it("asks for a password that wasn't remembered, and shows a wrong one inline", async () => {
    flags.web = true;
    useStudioStore.setState({
      savedLocal: { Orders: { ...orders, password: "" } },
    });
    connectPostgres.mockRejectedValueOnce("bad password");
    renderView();
    await userEvent.dblClick(row());

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Password for Orders");
    expect(connectPostgres).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Password"), "nope{Enter}");
    expect(await screen.findByText("bad password")).toBeVisible();

    await userEvent.clear(screen.getByLabelText("Password"));
    await userEvent.type(screen.getByLabelText("Password"), "pw{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(connectPostgres.mock.calls[1][0]).toMatchObject({ password: "pw" });
    expect(useStudioStore.getState().savedLocal.Orders.password).toBe("");
  });
});
