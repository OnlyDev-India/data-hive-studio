import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { TableSchema } from "@/shared/api";

const api = vi.hoisted(() => ({ tableSchema: vi.fn() }));

vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  ...api,
}));

import { SchemaTab } from "..";

const schema = (col: string): TableSchema => ({
  kind: "table",
  columns: [
    {
      name: col,
      data_type: "uuid",
      not_null: true,
      primary_key: true,
      default: null,
    },
  ],
  foreign_keys: [],
  indexes: [],
  triggers: [],
});

beforeEach(() => {
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

const props = {
  conn_id: "c1",
  table: "User",
  store_key: "t1",
  on_modified: () => {},
};

describe("SchemaTab first load", () => {
  it("uses the schema the pane already fetched instead of fetching again", async () => {
    render(<SchemaTab {...props} initial_schema={schema("seeded_id")} />);

    expect(await screen.findByText("seeded_id")).toBeTruthy();
    expect(api.tableSchema).not.toHaveBeenCalled();
  });

  it("fetches for itself when the pane has nothing to give", async () => {
    api.tableSchema.mockResolvedValue(schema("fetched_id"));

    render(<SchemaTab {...props} />);

    await waitFor(() => expect(api.tableSchema).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("fetched_id")).toBeTruthy();
  });
});
