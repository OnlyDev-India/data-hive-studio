import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
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

import { Grid, type GridHandle } from "../grid";

const schema: TableSchema = {
  kind: "table",
  columns: [
    {
      name: "id",
      data_type: "integer",
      not_null: true,
      primary_key: true,
      default: null,
    },
    {
      name: "name",
      data_type: "text",
      not_null: false,
      primary_key: false,
      default: null,
    },
  ],
  foreign_keys: [],
  indexes: [],
  triggers: [],
};

const meta: QueryResult = {
  columns: ["id", "name"],
  rows: [],
  rows_affected: 0,
  is_select: true,
  error: null,
  elapsed_ms: 1,
};

// Two pages of two rows each, served by the op's offset.
const pages: Record<number, (string | null)[][]> = {
  0: [
    ["1", "ann"],
    ["2", "bob"],
  ],
  2: [
    ["3", "cat"],
    ["4", "dan"],
  ],
};

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
    ...meta,
    columns: ["count"],
    rows: [["4"]],
  });
  api.executeOpStream.mockImplementation(
    async (
      _conn: string,
      op: { offset: number },
      push: (c: { columns: string[]; rows: (string | null)[][] }) => void,
    ) => {
      push({ columns: meta.columns, rows: pages[op.offset] ?? [] });
      return meta;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const bridge = (tab: string) => useStudioStore.getState().gridBridges[tab];

describe("Grid staged changes across pages", () => {
  it("keeps an edit made on page 1 in review and SQL after moving to page 2", async () => {
    const tab = "tab-across-pages";
    const ref = createRef<GridHandle>();
    render(
      <Grid
        ref={ref}
        conn_id="c1"
        table="members"
        schema={schema}
        revision={0}
        tab_key={tab}
        filters={[]}
        custom_where=""
        distinct={{}}
        kind="postgres"
        database="app"
      />,
    );
    await waitFor(() => expect(bridge(tab)?.loading).toBe(false));
    act(() => bridge(tab)!.set_page_size(2));
    await waitFor(() => expect(ref.current?.session().rows).toEqual(pages[0]));

    act(() => ref.current!.edit_field("name", 1, "bobby"));

    act(() => bridge(tab)!.set_page(1));
    await waitFor(() => expect(ref.current?.session().rows).toEqual(pages[2]));

    const changes = bridge(tab)!.get_pending_changes();
    expect(changes).toEqual([
      expect.objectContaining({
        kind: "update",
        row: 2,
        column: "name",
        before: "bob",
        after: "bobby",
      }),
    ]);
    expect(bridge(tab)!.get_pending_sql()).toContain(`WHERE "id" = '2'`);
    // A SQL grid offers no Mongo shell text.
    expect(bridge(tab)!.get_pending_nosql).toBeUndefined();
  });

  it("offers the staged changes as Mongo shell text on a Mongo grid", async () => {
    const tab = "tab-mongo-nosql";
    const ref = createRef<GridHandle>();
    render(
      <Grid
        ref={ref}
        conn_id="c1"
        table="members"
        schema={schema}
        revision={0}
        tab_key={tab}
        filters={[]}
        custom_where=""
        distinct={{}}
        kind="mongo"
        database="app"
      />,
    );
    await waitFor(() => expect(bridge(tab)?.loading).toBe(false));
    await waitFor(() => expect(ref.current?.session().rows.length).toBe(2));

    act(() => ref.current!.edit_field("name", 1, "bobby"));

    expect(bridge(tab)!.get_pending_nosql?.()).toBe(
      'db.members.updateMany({ "id": { "$numberLong": "2" } }, { "$set": { "name": "bobby" } });',
    );
  });
});
