import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { QueryResult, TableSchema } from "@/shared/api";
import { useStudioStore } from "@/shared/store";

const api = vi.hoisted(() => ({
  executeOp: vi.fn(),
  executeOpStream: vi.fn(),
  tableSchema: vi.fn(),
  mongoFieldTree: vi.fn(),
}));

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  ...api,
}));

// The schema editor is a large surface with its own tests; a stand in that
// shows what the pane handed it is enough to prove the ordering here.
vi.mock("@/features/schema-designer", () => ({
  SchemaTab: (p: { initial_schema?: unknown }) => (
    <div
      data-testid="schema-tab"
      data-seeded={p.initial_schema ? "yes" : "no"}
    />
  ),
  FieldsTree: () => null,
  MongoSchemaEditor: () => <div data-testid="mongo-schema-editor" />,
}));

import { TablePane } from "../table-pane";
import { MongoCollectionPane } from "../mongo-collection-pane";

const CONN = "c1";
const TAB = "t1";

const schema: TableSchema = {
  kind: "table",
  columns: [
    {
      name: "id",
      data_type: "uuid",
      not_null: true,
      primary_key: true,
      default: null,
    },
  ],
  foreign_keys: [],
  indexes: [],
  triggers: [],
};

const page: QueryResult = {
  columns: ["id"],
  rows: [],
  rows_affected: 0,
  is_select: true,
  error: null,
  elapsed_ms: 1,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function open_with_mode(mode: "data" | "schema") {
  useStudioStore.setState({
    open: [{ id: CONN, name: "db", kind: "postgres" }],
    workspaces: { [CONN]: { paneModes: { [TAB]: mode } } },
  } as never);
}

beforeEach(() => {
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  api.executeOp.mockResolvedValue({
    ...page,
    columns: ["count"],
    rows: [["0"]],
  });
  api.mongoFieldTree.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  useStudioStore.setState({ gridBridges: {}, workspaces: {} } as never);
});

const table_pane = () => (
  <TablePane
    conn_id={CONN}
    tab_key={TAB}
    table="User"
    revision={0}
    on_modified={() => {}}
  />
);

describe("TablePane load order", () => {
  it("fetches the rows first and the structure only after they settle", async () => {
    open_with_mode("data");
    const rows = deferred<QueryResult>();
    api.executeOpStream.mockReturnValue(rows.promise);
    api.tableSchema.mockResolvedValue(schema);

    render(table_pane());

    // The grid asks for its rows straight away, with no schema to wait for...
    await waitFor(() => expect(api.executeOpStream).toHaveBeenCalledTimes(1));
    // ...and the seven catalog queries have not been started behind them.
    await act(async () => {});
    expect(api.tableSchema).not.toHaveBeenCalled();

    await act(async () => {
      rows.resolve(page);
    });
    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
  });

  it("opens straight on Schema without running the data query", async () => {
    open_with_mode("schema");
    api.tableSchema.mockResolvedValue(schema);

    render(table_pane());

    // The pane's one structure fetch is handed to the editor, which then has
    // nothing left to fetch itself.
    const editor = await screen.findByTestId("schema-tab");
    expect(editor.dataset.seeded).toBe("yes");
    expect(api.tableSchema).toHaveBeenCalledTimes(1);
    expect(api.executeOpStream).not.toHaveBeenCalled();
    expect(api.executeOp).not.toHaveBeenCalled();
  });

  it("keeps the rows on screen when the structure fails to load", async () => {
    open_with_mode("data");
    api.executeOpStream.mockResolvedValue(page);
    api.tableSchema.mockRejectedValue(
      new Error("describe User: pool timed out"),
    );

    render(table_pane());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/pool timed out/);
    expect(alert.textContent).toMatch(/editing is off/i);
    // The grid is still there, finished loading, just not editable.
    const bridge = useStudioStore.getState().gridBridges[TAB];
    expect(bridge?.loading).toBe(false);
    expect(bridge?.editable).toBe(false);
  });

  it("offers Stop on the loading screen and moves on to the structure once used", async () => {
    open_with_mode("data");
    api.executeOpStream.mockReturnValue(deferred<QueryResult>().promise);
    api.tableSchema.mockResolvedValue(schema);

    render(table_pane());

    const stop = await screen.findByRole("button", { name: /stop/i });
    await act(async () => {});
    expect(api.tableSchema).not.toHaveBeenCalled();

    fireEvent.click(stop);

    // A stopped fetch counts as settled: the structure loads behind it, the
    // spinner goes, and the tab says what happened.
    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/Loading…/)).toBeNull());
    expect(screen.getByRole("status").textContent).toMatch(/query stopped/i);
  });

  it("keeps the filter bar available while the structure is still loading", async () => {
    open_with_mode("data");
    api.executeOpStream.mockImplementation(
      async (
        _conn: string,
        _op: unknown,
        on_chunk: (c: { columns?: string[]; rows: string[][] }) => void,
      ) => {
        on_chunk({ columns: ["id"], rows: [["a"]] });
        return page;
      },
    );
    // The structure never arrives.
    api.tableSchema.mockReturnValue(deferred<TableSchema>().promise);

    render(table_pane());

    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
    expect(screen.getByText("Where")).toBeTruthy();
  });

  it("does not build the schema editor until Schema is opened", async () => {
    open_with_mode("data");
    api.executeOpStream.mockResolvedValue(page);
    api.tableSchema.mockResolvedValue(schema);

    render(table_pane());
    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(screen.queryByTestId("schema-tab")).toBeNull();

    await act(async () => {
      useStudioStore.getState().setPaneMode(CONN, TAB, "schema");
    });
    const editor = await screen.findByTestId("schema-tab");
    expect(editor.dataset.seeded).toBe("yes");
    // Still one structure fetch: the editor reused the pane's copy.
    expect(api.tableSchema).toHaveBeenCalledTimes(1);
  });
});

describe("MongoCollectionPane load order", () => {
  const mongo_pane = () => (
    <MongoCollectionPane
      conn_id={CONN}
      tab_key={TAB}
      database="app"
      collection="members"
      on_modified={() => {}}
    />
  );

  it("fetches the documents first and the structure only after they settle", async () => {
    open_with_mode("data");
    const rows = deferred<QueryResult>();
    api.executeOpStream.mockReturnValue(rows.promise);
    api.tableSchema.mockResolvedValue(schema);

    render(mongo_pane());

    await waitFor(() => expect(api.executeOpStream).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(api.tableSchema).not.toHaveBeenCalled();

    await act(async () => {
      rows.resolve(page);
    });
    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
  });

  it("opens straight on Schema without running the data query", async () => {
    open_with_mode("schema");
    api.tableSchema.mockResolvedValue(schema);

    render(mongo_pane());

    await screen.findByTestId("mongo-schema-editor");
    expect(api.tableSchema).toHaveBeenCalledTimes(1);
    expect(api.executeOpStream).not.toHaveBeenCalled();
    expect(api.executeOp).not.toHaveBeenCalled();
  });
});
