import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriCore } from "@/test/mock-tauri";

const { connectPostgres, connectMongo, closeConnection } = vi.hoisted(() => ({
  connectPostgres: vi.fn(),
  connectMongo: vi.fn(),
  closeConnection: vi.fn(),
}));

vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  connectPostgres,
  connectMongo,
  closeConnection,
}));

import { useStudioStore } from "@/shared/store";
import { Landing } from "../landing";
import { useConnectionDrafts } from "../../lib/drafts";
import { pgConnectParams } from "../../lib/build-params";
import { PG_DEFAULTS } from "../../lib/defaults";

beforeEach(() => {
  useConnectionDrafts.getState().reset();
  connectPostgres
    .mockReset()
    .mockResolvedValue({ id: "p1", name: "orders", kind: "postgres" });
  connectMongo
    .mockReset()
    .mockResolvedValue({ id: "m1", name: "app", kind: "mongodb" });
  closeConnection.mockReset().mockResolvedValue(undefined);
  useStudioStore.setState({
    savedLocal: {},
    open: [],
    recentParams: {},
    landingForm: null,
  });
  localStorage.clear();
});
afterEach(cleanup);

const click = (role: string, name: string | RegExp) =>
  userEvent.click(screen.getByRole(role, { name }));
const type = (label: string | RegExp, text: string) =>
  userEvent.type(screen.getByLabelText(label), text);
const tab = (name: RegExp) => screen.getByRole("tab", { name });

async function openKind(kind: string) {
  await click("radio", kind);
  await click("button", "Next");
}

describe("step one", () => {
  it("starts on a picker with PostgreSQL selected and no tabs", () => {
    render(<Landing />);
    expect(screen.getByText("New Connection")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "PostgreSQL" })).toBeChecked();
    const names = ["SQLite", "PostgreSQL", "MongoDB", "Amazon DocumentDB"];
    screen
      .getAllByRole("radio")
      .forEach((r, i) => expect(r).toHaveAccessibleName(names[i]));
    expect(screen.queryByRole("tab")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /new connection/i }),
    ).toBeNull();
  });

  it("filters by search, Enter opens the first match, and no match disables Next", async () => {
    render(<Landing />);
    const search = screen.getByLabelText("Search database types");
    await userEvent.type(search, "zzz");
    expect(screen.getByText("No match.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await userEvent.clear(search);
    await userEvent.type(search, "MONGO{Enter}");
    expect(await screen.findByLabelText("Auth source")).toBeInTheDocument();
  });

  it("opens step two on a double click", async () => {
    render(<Landing />);
    await userEvent.dblClick(screen.getByRole("radio", { name: "MongoDB" }));
    expect(await screen.findByLabelText("Auth source")).toBeInTheDocument();
  });
});

describe("PostgreSQL form", () => {
  it("shows the rows in order with every tab, Connection active", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Connection",
      "Safety",
      "TLS/SSL",
      "SSH Tunnel",
      "Advanced",
    ]);
    expect(tab(/connection/i)).toHaveAttribute("aria-selected", "true");
    for (const label of [
      "URL",
      "Name",
      "Host",
      "Port",
      "User",
      "Password",
      "Database",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    expect(screen.getByLabelText("Database")).toHaveAttribute(
      "placeholder",
      "Optional, defaults to postgres",
    );
  });

  it("connects with the same payload the builder makes, then resets", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await userEvent.clear(screen.getByLabelText("Host"));
    await type("Host", "db.example");
    await type("Password", "pw");
    await click("button", "Connect");

    await waitFor(() => expect(connectPostgres).toHaveBeenCalledOnce());
    expect(connectPostgres.mock.calls[0][0]).toEqual(
      pgConnectParams({ ...PG_DEFAULTS, host: "db.example", password: "pw" }),
    );
    expect(useStudioStore.getState().recentParams.p1).toMatchObject({
      kind: "postgres",
      host: "db.example",
    });
    expect(useConnectionDrafts.getState().step).toBe("pick");
  });

  it("keeps the form when Connect fails", async () => {
    connectPostgres.mockRejectedValue("refused");
    render(<Landing />);
    await openKind("PostgreSQL");
    await type("Name", "Orders");
    await click("button", "Connect");

    await waitFor(() => expect(connectPostgres).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("Name")).toHaveValue("Orders");
  });

  it("tests with a blank database and closes the test connection", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await click("button", "Test");

    expect(await screen.findByText("Connection successful.")).toBeVisible();
    expect(connectPostgres.mock.calls[0][0].database).toBe("postgres");
    expect(closeConnection).toHaveBeenCalledWith("p1");
  });

  it("shows a failed test under the footer", async () => {
    connectPostgres.mockRejectedValue("bad password");
    render(<Landing />);
    await openKind("PostgreSQL");
    await click("button", "Test");
    expect(await screen.findByText("bad password")).toBeVisible();
  });

  it("points a MongoDB URL at the MongoDB card and changes nothing", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await type("URL", "mongodb://h/db{Enter}");
    expect(
      await screen.findByText(
        "This is a MongoDB URL. Go back and pick MongoDB.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Host")).toHaveValue("localhost");
  });

  it("fills the form from a URL and clears the box", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await type("URL", "postgres://app:pw@db.example:6543/orders");
    await click("button", /fill the form/i);
    expect(screen.getByLabelText("Host")).toHaveValue("db.example");
    expect(screen.getByLabelText("Port")).toHaveValue("6543");
    expect(screen.getByLabelText("URL")).toHaveValue("");
  });

  it("saves once, then updates the same entry", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await type("Name", "Orders");
    await click("button", "Save");
    await waitFor(() =>
      expect(useStudioStore.getState().savedLocal.Orders).toBeDefined(),
    );
    expect(
      await screen.findByText("Edit Connection · Orders"),
    ).toBeInTheDocument();

    await type("Database", "orders");
    await click("button", "Save");
    await waitFor(() =>
      expect(useStudioStore.getState().savedLocal.Orders.database).toBe(
        "orders",
      ),
    );
    expect(Object.keys(useStudioStore.getState().savedLocal)).toEqual([
      "Orders",
    ]);
  });

  it("marks a tab holding a changed setting", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    expect(tab(/safety/i).querySelector("[aria-label=changed]")).toBeNull();
    await userEvent.click(tab(/safety/i));
    await userEvent.click(screen.getByRole("switch", { name: /read only/i }));
    expect(tab(/safety/i).querySelector("[aria-label=changed]")).not.toBeNull();
  });
});

describe("moving between steps", () => {
  it("keeps each kind's draft across Previous and the Type pencil", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await type("Name", "Pg one");
    await click("button", "Previous");
    await openKind("MongoDB");
    await type("Name", "Mongo one");
    await click("button", "Change database type");
    await openKind("PostgreSQL");
    expect(screen.getByLabelText("Name")).toHaveValue("Pg one");
  });

  it("New connection clears every draft back to a fresh step one", async () => {
    render(<Landing />);
    await openKind("PostgreSQL");
    await type("Name", "Pg one");
    await click("button", /new connection/i);
    expect(screen.getByRole("radio", { name: "PostgreSQL" })).toBeChecked();
    await openKind("PostgreSQL");
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });
});

describe("MongoDB validation", () => {
  it("sends nothing, opens the first problem tab and marks SSH red", async () => {
    render(<Landing />);
    await openKind("MongoDB");
    await userEvent.click(tab(/ssh tunnel/i));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByPlaceholderText(/bastion/i), "bastion");
    await click("button", "Connect");

    expect(connectMongo).not.toHaveBeenCalled();
    expect(tab(/^connection/i)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Database is required.")).toBeVisible();
    expect(
      tab(/ssh tunnel/i).querySelector("[aria-label='has a problem']"),
    ).not.toBeNull();
  });

  it("hides Port while SRV is on, and DocumentDB has no SRV but a Replica set", async () => {
    render(<Landing />);
    await openKind("MongoDB");
    await click("checkbox", "Use mongodb+srv://");
    expect(screen.queryByLabelText("Port")).toBeNull();
    await click("button", "Previous");
    await openKind("Amazon DocumentDB");
    expect(screen.queryByLabelText("Use mongodb+srv://")).toBeNull();
    expect(screen.getByLabelText("Replica set")).toHaveValue("rs0");
    expect(screen.getByLabelText("Port")).toHaveValue("27017");
  });
});
