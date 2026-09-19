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

const saved_file = {
  name: "Orders",
  kind: "sqlite" as const,
  host: "",
  port: 0,
  user: "",
  password: "",
  database: "",
  source_path: "/d/app.db",
};

beforeEach(() => {
  openDatabasePath.mockReset().mockResolvedValue(opened);
  pickDatabaseFile.mockReset().mockResolvedValue({
    path: "/d/app.db",
    name: "app.db",
    bytes: [],
  });
  useStudioStore.setState({ savedLocal: {}, open: [], landingPrefill: null });
  localStorage.clear();
});
afterEach(cleanup);

const saved = () => useStudioStore.getState().savedLocal;
const readOnlySwitch = () => screen.getByRole("switch", { name: /read only/i });

describe("Landing, SQLite read only", () => {
  it("opens a browsed file read only when the switch is on", async () => {
    render(<Landing />);
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await userEvent.click(readOnlySwitch());
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() =>
      expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db", {
        read_only: true,
      }),
    );
  });

  it("opens a file with the switch untouched as a normal, writable one", async () => {
    render(<Landing />);
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(openDatabasePath).toHaveBeenCalledOnce());
    expect(openDatabasePath.mock.calls[0]).toEqual(["/d/app.db"]);
  });

  it("saves the flag with the file", async () => {
    render(<Landing />);
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    await userEvent.click(readOnlySwitch());
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saved()["app.db"]).toBeDefined());
    expect(saved()["app.db"]).toMatchObject({
      kind: "sqlite",
      source_path: "/d/app.db",
      read_only: true,
    });
  });

  it("loads a saved read only file with the switch on, without opening it", async () => {
    render(<Landing />);
    act(() =>
      useStudioStore
        .getState()
        .requestLandingPrefill("sqlite", { ...saved_file, read_only: true }),
    );

    expect(await screen.findByText("/d/app.db")).toBeInTheDocument();
    expect(readOnlySwitch()).toBeChecked();
    expect(openDatabasePath).not.toHaveBeenCalled();
  });

  it("opens a saved read only file read only when it is double clicked", async () => {
    render(<Landing />);
    act(() =>
      useStudioStore
        .getState()
        .requestLandingPrefill(
          "sqlite",
          { ...saved_file, read_only: true },
          true,
        ),
    );

    await waitFor(() =>
      expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db", {
        read_only: true,
      }),
    );
  });

  it("shows a file saved before read only existed with the switch off", async () => {
    render(<Landing />);
    act(() =>
      useStudioStore.getState().requestLandingPrefill("sqlite", saved_file),
    );

    expect(await screen.findByText("/d/app.db")).toBeInTheDocument();
    expect(readOnlySwitch()).not.toBeChecked();
  });

  it("turns read only off in a saved connection when editing", async () => {
    useStudioStore.setState({
      savedLocal: { Orders: { ...saved_file, read_only: true } },
    });
    render(<Landing />);
    act(() =>
      useStudioStore
        .getState()
        .requestLandingPrefill(
          "sqlite",
          { ...saved_file, read_only: true },
          false,
          { source: "local", oldName: "Orders", name: "Orders" },
        ),
    );

    await screen.findByText("/d/app.db");
    expect(readOnlySwitch()).toBeChecked();
    await userEvent.click(readOnlySwitch());
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(saved()["Orders"]?.read_only).toBe(false));
  });
});
