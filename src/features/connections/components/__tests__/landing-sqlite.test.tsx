import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { openDatabasePath, pickDatabaseFile } = vi.hoisted(() => ({
  openDatabasePath: vi.fn(),
  pickDatabaseFile: vi.fn(),
}));

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  openDatabasePath,
}));
vi.mock("@/shared/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/platform")>()),
  pickDatabaseFile,
}));

import { useStudioStore } from "@/shared/store";
import { Landing } from "../landing";

const opened = {
  id: "c1",
  name: "app.db",
  kind: "sqlite",
  source_path: "/d/app.db",
};

beforeEach(() => {
  openDatabasePath.mockReset().mockResolvedValue(opened);
  pickDatabaseFile.mockReset();
  useStudioStore.setState({ savedLocal: {}, open: [], landingPrefill: null });
  localStorage.clear();
});
afterEach(cleanup);

const saved = () => useStudioStore.getState().savedLocal;

describe("Landing, SQLite", () => {
  it("saves a browsed file without opening it", async () => {
    pickDatabaseFile.mockResolvedValue({
      path: "/d/app.db",
      name: "app.db",
      bytes: [],
    });
    render(<Landing />);

    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await userEvent.click(await screen.findByRole("button", { name: /save/i }));

    await waitFor(() => expect(saved()["app.db"]).toBeDefined());
    expect(saved()["app.db"]).toMatchObject({
      kind: "sqlite",
      source_path: "/d/app.db",
    });
    expect(openDatabasePath).not.toHaveBeenCalled();
  });

  it("uses the typed name when saving", async () => {
    pickDatabaseFile.mockResolvedValue({
      path: "/d/app.db",
      name: "app.db",
      bytes: [],
    });
    render(<Landing />);

    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await userEvent.type(
      screen.getByPlaceholderText(/connection name/i),
      "Orders",
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saved()["Orders"]).toBeDefined());
  });

  it("opens the browsed file with Open", async () => {
    pickDatabaseFile.mockResolvedValue({
      path: "/d/app.db",
      name: "app.db",
      bytes: [],
    });
    render(<Landing />);

    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db"),
    );
  });

  it("opens a saved SQLite connection when it is double clicked in the sidebar", async () => {
    render(<Landing />);

    act(() =>
      useStudioStore.getState().requestLandingPrefill(
        "sqlite",
        {
          name: "Orders",
          kind: "sqlite",
          host: "",
          port: 0,
          user: "",
          password: "",
          database: "",
          source_path: "/d/app.db",
        },
        true,
      ),
    );

    await waitFor(() =>
      expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db"),
    );
  });

  it("only loads the file on a single click, without opening it", async () => {
    render(<Landing />);

    act(() =>
      useStudioStore.getState().requestLandingPrefill("sqlite", {
        name: "Orders",
        kind: "sqlite",
        host: "",
        port: 0,
        user: "",
        password: "",
        database: "",
        source_path: "/d/app.db",
      }),
    );

    expect(await screen.findByText("/d/app.db")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/connection name/i)).toHaveValue(
      "Orders",
    );
    expect(openDatabasePath).not.toHaveBeenCalled();
  });

  it("updates the saved connection in place when editing", async () => {
    useStudioStore.setState({
      savedLocal: {
        Orders: {
          name: "Orders",
          kind: "sqlite",
          host: "",
          port: 0,
          user: "",
          password: "",
          database: "",
          source_path: "/d/old.db",
        },
      },
    });
    render(<Landing />);

    act(() =>
      useStudioStore
        .getState()
        .requestLandingPrefill(
          "sqlite",
          { ...saved()["Orders"], source_path: "/d/old.db" },
          false,
          { source: "local", oldName: "Orders", name: "Orders" },
        ),
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Update" }),
    );

    await waitFor(() => expect(Object.keys(saved())).toEqual(["Orders"]));
    expect(saved()["Orders"].source_path).toBe("/d/old.db");
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });
});
