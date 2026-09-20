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
}));

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  ...api,
}));

import { Grid } from "../grid";

const schema: TableSchema = {
  kind: "table",
  columns: [
    {
      name: "_id",
      data_type: "objectid",
      not_null: false,
      primary_key: true,
      default: null,
    },
  ],
  foreign_keys: [],
  indexes: [],
  triggers: [],
};

const page: QueryResult = {
  columns: ["_id"],
  rows: [],
  rows_affected: 0,
  is_select: true,
  error: null,
  elapsed_ms: 1,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  // jsdom has no Element.scrollTo; the grid scrolls to the top on mount.
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const bridge = (tab: string) => useStudioStore.getState().gridBridges[tab];

function mount(
  tab: string,
  over: { conn_id?: string; schema?: TableSchema } = {},
) {
  return render(
    <Grid
      conn_id={over.conn_id ?? "c1"}
      table="members"
      schema={over.schema ?? schema}
      revision={0}
      tab_key={tab}
      filters={[]}
      custom_where=""
      distinct={{}}
      kind="mongo"
      database="app"
    />,
  );
}

describe("Grid page load", () => {
  it("stops loading when the rows are in, without waiting for the count", async () => {
    // A big Mongo collection: the page comes back at once, the count is slow.
    const count = deferred<QueryResult>();
    api.executeOpStream.mockResolvedValue(page);
    api.executeOp.mockReturnValue(count.promise);

    mount("tab-slow-count");

    await waitFor(() => expect(bridge("tab-slow-count")).toBeTruthy());
    await waitFor(() => expect(bridge("tab-slow-count")?.loading).toBe(false));
    expect(bridge("tab-slow-count")?.total_pending).toBe(true);
    expect(api.executeOp).toHaveBeenCalledTimes(1);

    // The count lands later and only fills in the total.
    await act(async () => {
      count.resolve({ ...page, columns: ["count"], rows: [["4200"]] });
    });
    await waitFor(() => expect(bridge("tab-slow-count")?.total).toBe(4200));
    expect(bridge("tab-slow-count")?.total_pending).toBe(false);
    expect(bridge("tab-slow-count")?.loading).toBe(false);
  });

  it("still shows the rows when the count fails", async () => {
    // Rows arrive through the streamed chunks, as the real API delivers them.
    api.executeOpStream.mockImplementation(
      async (
        _conn: string,
        _op: unknown,
        on_chunk: (c: { columns?: string[]; rows: string[][] }) => void,
      ) => {
        on_chunk({ columns: ["_id"], rows: [["a"]] });
        return page;
      },
    );
    api.executeOp.mockRejectedValue(new Error("count blew up"));

    mount("tab-failed-count");

    await waitFor(() =>
      expect(bridge("tab-failed-count")?.loading).toBe(false),
    );
    await waitFor(() =>
      expect(bridge("tab-failed-count")?.total_pending).toBe(false),
    );
    expect(bridge("tab-failed-count")?.rows).toBe(1);
  });
});

describe("Grid stop and failure", () => {
  it("stops waiting on Stop, shows the stopped state, and ignores the late rows", async () => {
    const rows = deferred<QueryResult>();
    api.executeOpStream.mockReturnValue(rows.promise);
    api.executeOp.mockResolvedValue({
      ...page,
      columns: ["count"],
      rows: [["1"]],
    });

    mount("tab-stop");
    await waitFor(() => expect(bridge("tab-stop")?.loading).toBe(true));

    await act(async () => {
      bridge("tab-stop")?.stop?.();
    });
    expect(bridge("tab-stop")?.loading).toBe(false);
    expect(screen.getByRole("status").textContent).toMatch(/query stopped/i);

    // The database answers after all: the grid stays on the stopped state.
    await act(async () => {
      rows.resolve({ ...page, columns: ["_id"] });
    });
    expect(bridge("tab-stop")?.rows).toBe(0);
    expect(screen.getByRole("status").textContent).toMatch(/query stopped/i);

    // Reload runs the fetch again.
    api.executeOpStream.mockResolvedValue(page);
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    await waitFor(() => expect(api.executeOpStream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("says why the rows are missing when the page query fails", async () => {
    api.executeOpStream.mockRejectedValue(new Error("syntax error near WHERE"));
    api.executeOp.mockResolvedValue({
      ...page,
      columns: ["count"],
      rows: [["0"]],
    });

    mount("tab-failed-page");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/syntax error near WHERE/);
    expect(bridge("tab-failed-page")?.loading).toBe(false);
    expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
  });
});

describe("Grid foreign key labels", () => {
  it("looks up a referenced table's schema once, not on every open", async () => {
    const with_fk: TableSchema = {
      ...schema,
      foreign_keys: [
        {
          column: "team_id",
          referenced_table: "teams",
          referenced_column: "_id",
        },
      ],
    };
    api.executeOpStream.mockResolvedValue(page);
    api.executeOp.mockResolvedValue({
      ...page,
      columns: ["count"],
      rows: [["0"]],
    });
    api.tableSchema.mockResolvedValue({
      ...schema,
      columns: [
        { ...schema.columns[0] },
        {
          name: "name",
          data_type: "text",
          not_null: false,
          primary_key: false,
          default: null,
        },
      ],
    });

    const first = mount("tab-fk-1", { conn_id: "c-fk", schema: with_fk });
    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bridge("tab-fk-1")?.loading).toBe(false));
    first.unmount();

    // Opening another table that points at the same teams table, a while
    // later than tableSchema's own 300 ms dedupe window.
    mount("tab-fk-2", { conn_id: "c-fk", schema: with_fk });
    await waitFor(() => expect(bridge("tab-fk-2")?.loading).toBe(false));
    expect(api.tableSchema).toHaveBeenCalledTimes(1);
  });
});
