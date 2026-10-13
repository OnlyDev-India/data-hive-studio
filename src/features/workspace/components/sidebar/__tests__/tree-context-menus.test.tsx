import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriCore } from "@/test/mock-tauri";

const api = vi.hoisted(() => ({
  catalogOverview: vi.fn(),
  listSchemasIn: vi.fn(),
  listSchemaObjects: vi.fn(),
  listExtensions: vi.fn(),
  createPgSchema: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  ...api,
}));

import { tabKey, useStudioStore } from "@/shared/store";
import { TablesBrowser } from "../table-view";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function connect(kind: "postgres" | "sqlite", read_only = false) {
  useStudioStore.setState({
    open: [{ id: "c1", name: "orders", kind, read_only }],
    recentParams: {},
    savedLocal: {},
    workspaces: {},
    sqlSeeds: {},
    sqlTargets: {},
    newTableTargets: {},
  } as never);
}

function renderTree(tables: { name: string; kind: string }[] = []) {
  const on_refresh = vi.fn();
  render(
    <TablesBrowser
      conn_id="c1"
      tables={tables}
      active_table={null}
      on_open_table={() => {}}
      on_refresh={on_refresh}
      search_value=""
      on_search_change={() => {}}
    />,
  );
  return on_refresh;
}

/** Opens `db` then its `public` schema, so the category headers show. */
async function openSchema(db: string) {
  await screen.findByRole("button", { name: new RegExp(`^${db}`) });
  await userEvent.click(header(db));
  await userEvent.click(await screen.findByRole("button", { name: "public" }));
}

/** A row by its label; the primary database's name also carries "Default". */
const header = (label: string) =>
  screen.getByRole("button", { name: new RegExp(`^${label}\\s*(Default)?$`) });
const menuItem = (label: string) =>
  screen.findByRole("menuitem", { name: label });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.catalogOverview.mockResolvedValue({
    databases: ["orders", "sales"],
    active_schema: "public",
    schemas: ["public"],
  });
  api.listSchemasIn.mockResolvedValue(["public"]);
  api.listSchemaObjects.mockResolvedValue([]);
  api.listExtensions.mockResolvedValue([]);
  api.createPgSchema.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("Postgres tree menus", () => {
  it("refreshes only the category that was right clicked", async () => {
    connect("postgres");
    renderTree();
    await openSchema("orders");
    api.listSchemaObjects.mockClear();

    fireEvent.contextMenu(header("Views"));
    await userEvent.click(await menuItem("Refresh"));

    await waitFor(() => expect(api.listSchemaObjects).toHaveBeenCalledTimes(1));
    expect(api.listSchemaObjects).toHaveBeenCalledWith(
      "c1",
      "public",
      "view",
      undefined,
    );
  });

  it("opens New view on the database the row belongs to", async () => {
    connect("postgres");
    renderTree();
    await openSchema("sales");

    fireEvent.contextMenu(header("Views"));
    await userEvent.click(await menuItem("New view"));

    const s = useStudioStore.getState();
    const tab = s.workspaces.c1?.tabs.find((t) => t.kind === "sql");
    expect(tab).toBeDefined();
    const key = tabKey(tab!);
    expect(s.sqlSeeds[key]).toMatch(/^CREATE VIEW "public"\.new_view AS/);
    expect(s.sqlTargets[key]).toEqual({ database: "sales" });
  });

  it("presets New table to the header's database and schema", async () => {
    connect("postgres");
    renderTree();
    await openSchema("sales");

    fireEvent.contextMenu(header("Tables"));
    await userEvent.click(await menuItem("New table"));

    const s = useStudioStore.getState();
    const tab = s.workspaces.c1?.tabs.find((t) => t.kind === "new-table");
    const key = tabKey(tab!);
    expect(s.newTableTargets[key]).toEqual({
      database: "sales",
      schema: "public",
    });
  });

  it("shows Failed to load under the one list whose refetch failed", async () => {
    connect("postgres");
    renderTree();
    await openSchema("orders");
    await userEvent.click(header("Views"));
    await userEvent.click(header("Functions"));
    expect(await screen.findByText("No views.")).toBeInTheDocument();

    api.listSchemaObjects.mockRejectedValueOnce(new Error("boom"));
    fireEvent.contextMenu(header("Views"));
    await userEvent.click(await menuItem("Refresh"));

    expect(await screen.findByText("Failed to load.")).toBeInTheDocument();
    expect(screen.getByText("No functions.")).toBeInTheDocument();
  });

  it("creates a schema in a sibling database and lists it there", async () => {
    connect("postgres");
    renderTree();
    await userEvent.click(await screen.findByRole("button", { name: "sales" }));
    await screen.findByRole("button", { name: "public" });

    fireEvent.contextMenu(header("sales"));
    await userEvent.click(await menuItem("New schema…"));
    expect(
      await screen.findByText("Create schema in sales"),
    ).toBeInTheDocument();
    api.listSchemasIn.mockResolvedValue(["public", "reports"]);
    await userEvent.type(screen.getByPlaceholderText("schema name"), "reports");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(api.createPgSchema).toHaveBeenCalledWith("c1", "reports", "sales");
    expect(
      await screen.findByRole("button", { name: "reports" }),
    ).toBeInTheDocument();
  });

  it("collapses a database and everything under it", async () => {
    connect("postgres");
    renderTree();
    await openSchema("orders");
    expect(header("Views")).toBeInTheDocument();

    fireEvent.contextMenu(header("orders"));
    await userEvent.click(await menuItem("Collapse all"));
    expect(screen.queryByRole("button", { name: "public" })).toBeNull();

    await userEvent.click(header("orders"));
    await screen.findByRole("button", { name: "public" });
    expect(screen.queryByRole("button", { name: "Views" })).toBeNull();
  });

  it("disables create items on a read only connection", async () => {
    connect("postgres", true);
    renderTree();
    await openSchema("orders");

    fireEvent.contextMenu(header("Tables"));
    const create = await menuItem("New table");
    expect(create).toHaveAttribute("data-disabled");
    expect(create).toHaveAttribute(
      "title",
      "Read only connection: this change is refused",
    );
    expect(await menuItem("Refresh")).not.toHaveAttribute("data-disabled");
  });

  it("opens a header's menu from the keyboard", async () => {
    connect("postgres");
    renderTree();
    await openSchema("orders");

    header("Views").focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    expect(await menuItem("New view")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: "New view" })).toBeNull(),
    );
    await waitFor(() => expect(header("Views")).toHaveFocus());
  });
});

describe("SQLite groups", () => {
  const tables = [
    { name: "alpha", kind: "table" },
    { name: "beta", kind: "table" },
    { name: "recent", kind: "view" },
  ];

  it("groups tables and views under their headers, both open", () => {
    connect("sqlite");
    renderTree(tables);
    expect(header("Tables")).toHaveAttribute("aria-expanded", "true");
    expect(header("Views")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("recent")).toBeInTheDocument();
  });

  it("skips a collapsed group when walking with the arrow keys", async () => {
    connect("sqlite");
    renderTree(tables);
    await userEvent.click(header("Views"));
    expect(screen.queryByText("recent")).toBeNull();

    await userEvent.click(screen.getByText("beta"));
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByText("beta").closest("[data-table]")).toHaveClass(
      "bg-muted",
    );
  });

  it("refreshes the table list from a group header", async () => {
    connect("sqlite");
    const on_refresh = renderTree(tables);
    fireEvent.contextMenu(header("Views"));
    await userEvent.click(await menuItem("Refresh"));
    expect(on_refresh).toHaveBeenCalled();
  });
});
