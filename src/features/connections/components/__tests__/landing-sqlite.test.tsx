import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriCore } from "@/test/mock-tauri";

const { openDatabasePath, pickDatabaseFile } = vi.hoisted(() => ({
  openDatabasePath: vi.fn(),
  pickDatabaseFile: vi.fn(),
}));

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  openDatabasePath,
}));
vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/web")>()),
  WEB: false,
}));
vi.mock("@/shared/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/lib/platform")>()),
  pickDatabaseFile,
}));

import { useStudioStore } from "@/shared/store";
import { Landing } from "../landing";
import { useConnectionDrafts } from "../../lib/drafts";
import { connectSaved } from "../../lib/connect-saved";

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
  useConnectionDrafts.getState().reset();
  openDatabasePath.mockReset().mockResolvedValue({
    id: "c1",
    name: "app.db",
    kind: "sqlite",
    source_path: "/d/app.db",
  });
  pickDatabaseFile.mockReset().mockResolvedValue({
    path: "/d/app.db",
    name: "app.db",
    bytes: [],
  });
  useStudioStore.setState({ savedLocal: {}, open: [], landingForm: null });
  localStorage.clear();
});
afterEach(cleanup);

const saved = () => useStudioStore.getState().savedLocal;
const click = (role: string, name: string | RegExp) =>
  userEvent.click(screen.getByRole(role, { name }));
const readOnlySwitch = () => screen.getByRole("switch", { name: /read only/i });

async function browseFile() {
  render(<Landing />);
  await click("radio", "SQLite");
  await click("button", "Next");
  await click("button", "Browse…");
  await screen.findByText("/d/app.db");
}

describe("Landing, SQLite", () => {
  it("shows only Connection and Safety tabs, and Save and Open", async () => {
    await browseFile();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Connection",
      "Safety",
    ]);
    expect(screen.queryByRole("button", { name: "Test" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });

  it("saves a browsed file without opening it", async () => {
    await browseFile();
    await click("button", "Save");

    await waitFor(() => expect(saved()["app.db"]).toBeDefined());
    expect(saved()["app.db"]).toMatchObject({
      kind: "sqlite",
      source_path: "/d/app.db",
    });
    expect(openDatabasePath).not.toHaveBeenCalled();
  });

  it("uses the typed name when saving", async () => {
    await browseFile();
    await userEvent.type(screen.getByLabelText("Name"), "Orders");
    await click("button", "Save");

    await waitFor(() => expect(saved()["Orders"]).toBeDefined());
  });

  it("asks for a file before saving", async () => {
    render(<Landing />);
    await click("radio", "SQLite");
    await click("button", "Next");
    await click("button", "Save");

    expect(await screen.findByText("Choose a database file.")).toBeVisible();
    expect(saved()).toEqual({});
  });

  it("opens the browsed file as a normal, writable one", async () => {
    await browseFile();
    await click("button", "Open");

    await waitFor(() => expect(openDatabasePath).toHaveBeenCalledOnce());
    expect(openDatabasePath.mock.calls[0]).toEqual(["/d/app.db"]);
    expect(useConnectionDrafts.getState().step).toBe("pick");
  });

  it("opens and saves read only when the switch is on", async () => {
    await browseFile();
    await click("tab", /safety/i);
    await userEvent.click(readOnlySwitch());
    await click("button", "Save");
    await waitFor(() =>
      expect(saved()["app.db"]).toMatchObject({ read_only: true }),
    );

    await click("button", "Open");
    await waitFor(() =>
      expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db", {
        read_only: true,
      }),
    );
  });

  it("loads a saved read only file into the form without opening it", async () => {
    render(<Landing />);
    act(() =>
      useStudioStore
        .getState()
        .requestLandingForm("sqlite", { ...saved_file, read_only: true }),
    );

    expect(await screen.findByText("/d/app.db")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Orders");
    await click("tab", /safety/i);
    expect(readOnlySwitch()).toBeChecked();
    expect(openDatabasePath).not.toHaveBeenCalled();
  });

  it("shows a file saved before read only existed with the switch off", async () => {
    render(<Landing />);
    act(() =>
      useStudioStore.getState().requestLandingForm("sqlite", saved_file),
    );

    await screen.findByText("/d/app.db");
    await click("tab", /safety/i);
    expect(readOnlySwitch()).not.toBeChecked();
  });

  it("updates the saved entry in place when editing", async () => {
    useStudioStore.setState({
      savedLocal: { Orders: { ...saved_file, read_only: true } },
    });
    render(<Landing />);
    act(() =>
      useStudioStore
        .getState()
        .requestLandingForm(
          "sqlite",
          { ...saved_file, read_only: true },
          { oldName: "Orders", name: "Orders" },
        ),
    );

    expect(
      await screen.findByText("Edit Connection · Orders"),
    ).toBeInTheDocument();
    await click("tab", /safety/i);
    await userEvent.click(readOnlySwitch());
    await click("button", "Save");

    await waitFor(() => expect(saved()["Orders"]?.read_only).toBe(false));
    expect(Object.keys(saved())).toEqual(["Orders"]);
  });
});

describe("connectSaved, SQLite", () => {
  it("opens a saved file directly, keeping its read only flag", async () => {
    await connectSaved("sqlite", { ...saved_file, read_only: true });
    expect(openDatabasePath).toHaveBeenCalledWith("/d/app.db", {
      read_only: true,
    });
    await connectSaved("sqlite", saved_file);
    expect(openDatabasePath.mock.calls[1]).toEqual(["/d/app.db"]);
  });
});
