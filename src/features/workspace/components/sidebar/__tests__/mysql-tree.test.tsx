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
  listSchemaObjects: vi.fn(),
  listRoles: vi.fn(),
  objectDefinition: vi.fn(),
  dropPgDatabase: vi.fn(),
  applySchemaOps: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  ...api,
}));

import { useStudioStore } from "@/shared/store";
import { TablesBrowser } from "../table-view";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function connect(read_only = false) {
  useStudioStore.setState({
    open: [{ id: "c1", name: "root@db", kind: "mysql", read_only }],
    recentParams: {},
    savedLocal: {},
    workspaces: {},
    sqlSeeds: {},
    sqlTargets: {},
    newTableTargets: {},
    showSystemDatabases: {},
  } as never);
}

function renderTree() {
  render(
    <TablesBrowser
      conn_id="c1"
      tables={[]}
      active_table={null}
      on_open_table={() => {}}
      on_refresh={() => {}}
      search_value=""
      on_search_change={() => {}}
    />,
  );
}

const row = (label: string) =>
  screen.findByRole("button", { name: new RegExp(`^${label}`) });
const menuItem = (label: string) =>
  screen.findByRole("menuitem", { name: label });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.catalogOverview.mockResolvedValue({
    databases: ["shop", "mysql", "sys", "information_schema"],
    active_schema: "",
    schemas: [],
  });
  api.listSchemaObjects.mockImplementation(
    (_c: string, _s: string, kind: string) =>
      Promise.resolve(
        kind === "table"
          ? [{ name: "items", extra: null }]
          : kind === "procedure"
            ? [{ name: "restock", extra: null }]
            : [],
      ),
  );
  api.listRoles.mockResolvedValue([{ name: "root@%", extra: "superuser" }]);
  api.objectDefinition.mockResolvedValue("CREATE PROCEDURE restock() ...");
  api.dropPgDatabase.mockResolvedValue(undefined);
  api.applySchemaOps.mockResolvedValue([]);
});
afterEach(cleanup);

describe("MySQL tree (spec 0025 AC-5 to AC-7)", () => {
  it("hides system databases until the server row's toggle shows them, and remembers it", async () => {
    connect();
    renderTree();
    await row("shop");
    expect(screen.queryByRole("button", { name: /^sys/ })).toBeNull();

    fireEvent.contextMenu(await row("root@db"));
    await userEvent.click(await menuItem("Show system databases"));
    await row("sys");
    expect(useStudioStore.getState().showSystemDatabases.c1).toBe(true);
  });

  it("lists the six groups under a database, Tables open first", async () => {
    connect();
    renderTree();
    await userEvent.click(await row("shop"));
    for (const g of [
      "Tables",
      "Views",
      "Procedures",
      "Functions",
      "Triggers",
      "Events",
    ])
      await row(g);
    await screen.findByText("items");
    expect(api.listSchemaObjects).toHaveBeenCalledWith(
      "c1",
      "",
      "table",
      "shop",
    );
  });

  it("opens a procedure's definition in a SQL tab on its database", async () => {
    connect();
    const open_sql = vi.fn();
    useStudioStore.setState({ openSql: open_sql } as never);
    renderTree();
    await userEvent.click(await row("shop"));
    await userEvent.click(await row("Procedures"));
    fireEvent.doubleClick(await screen.findByText("restock"));
    await waitFor(() =>
      expect(open_sql).toHaveBeenCalledWith(
        "c1",
        "CREATE PROCEDURE restock() ...",
        undefined,
        undefined,
        { database: "shop" },
      ),
    );
    expect(api.objectDefinition).toHaveBeenCalledWith(
      "c1",
      "procedure",
      "restock",
      "shop",
    );
  });

  it("shows Users & Privileges only when the accounts can be read", async () => {
    connect();
    renderTree();
    await row("Users & Privileges");
    cleanup();

    api.listRoles.mockResolvedValue([]);
    connect();
    renderTree();
    await row("shop");
    await waitFor(() => expect(api.listRoles).toHaveBeenCalled());
    expect(
      screen.queryByRole("button", { name: /^Users & Privileges/ }),
    ).toBeNull();
  });

  it("drops a database only once its name is typed back", async () => {
    connect();
    renderTree();
    fireEvent.contextMenu(await row("shop"));
    await userEvent.click(await menuItem("Drop database…"));
    const drop = await screen.findByRole("button", { name: "Drop" });
    expect(drop).toHaveProperty("disabled", true);
    await userEvent.type(
      screen.getByLabelText("Type the database name to confirm"),
      "shop",
    );
    await userEvent.click(drop);
    await waitFor(() =>
      expect(api.dropPgDatabase).toHaveBeenCalledWith("c1", "shop"),
    );
  });

  it("renames a table through one rename_table op", async () => {
    connect();
    renderTree();
    await userEvent.click(await row("shop"));
    fireEvent.contextMenu(await screen.findByText("items"));
    await userEvent.click(await menuItem("Rename table…"));
    const input = await screen.findByLabelText("New table name");
    await userEvent.clear(input);
    await userEvent.type(input, "goods{Enter}");
    await waitFor(() =>
      expect(api.applySchemaOps).toHaveBeenCalledWith(
        "c1",
        [{ kind: "rename_table", table: "items", new_name: "goods" }],
        "shop",
      ),
    );
  });

  it("disables the writes on a read only connection", async () => {
    connect(true);
    renderTree();
    fireEvent.contextMenu(await row("shop"));
    expect(await menuItem("Drop database…")).toHaveProperty(
      "ariaDisabled",
      "true",
    );
  });
});
