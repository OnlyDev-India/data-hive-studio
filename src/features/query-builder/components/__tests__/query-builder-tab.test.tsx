import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { SqlBuilderPreviewRequest, SqlPreviewChunk } from "@/shared/api";

const preview = vi.fn();
const runStream = vi.fn();
vi.mock("@/shared/api", async (orig) => ({
  ...(await orig<typeof import("@/shared/api")>()),
  canCancelRun: () => true,
  cancelRun: vi.fn(() => Promise.resolve()),
  previewSqlBuilder: (...a: unknown[]) => preview(...a),
  runSqlStream: (...a: unknown[]) => runStream(...a),
  listTables: vi.fn(() => Promise.resolve([{ name: "orders", kind: "table" }])),
  schemaGraph: vi.fn(() =>
    Promise.resolve({
      graph: {
        tables: [
          {
            schema: null,
            name: "orders",
            stub: false,
            columns: [
              {
                name: "id",
                data_type: "INTEGER",
                primary_key: true,
                not_null: true,
              },
              {
                name: "total",
                data_type: "REAL",
                primary_key: false,
                not_null: false,
              },
            ],
          },
        ],
        links: [],
      },
      statements: [],
    }),
  ),
  tableSchema: vi.fn(() => Promise.reject(new Error("unused"))),
}));

import { useStudioStore, type StudioStore } from "@/shared/store";
import { DEFAULT_QUERY_BUILDER_SETUP } from "@/shared/store/types";
import { ThemeProvider } from "@/shared/theme/theme";

const KEY = "query-builder:c1:0";
import { QueryBuilderTab } from "../query-builder-tab";

const mount = () =>
  render(
    <ThemeProvider>
      <QueryBuilderTab conn_id="c1" tab_key={KEY} active />
    </ThemeProvider>,
  );

class Observer {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", Observer);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  preview.mockReset();
  preview.mockImplementation(
    (
      _c: string,
      req: SqlBuilderPreviewRequest,
      on: (c: SqlPreviewChunk) => void,
    ) => {
      for (const t of req.targets)
        on({
          clause_id: t.clause_id,
          count: 37,
          columns: ["id", "total"],
          rows: [["1", "10"]],
          elapsed_ms: 3,
        });
      return Promise.resolve({ cancelled: false, source_rows: 1001 });
    },
  );
  useStudioStore.setState({
    open: [
      { id: "c1", kind: "sqlite", name: "shop" },
    ] as unknown as StudioStore["open"],
    queryBuilderTabs: {
      [KEY]: {
        ...DEFAULT_QUERY_BUILDER_SETUP,
        clauses: [
          {
            id: "f",
            kind: "from",
            body: "orders",
            aggregates: null,
            view: "form",
          },
          {
            id: "w",
            kind: "where",
            body: "total > 5",
            aggregates: null,
            view: "form",
          },
          { id: "l", kind: "limit", body: "", aggregates: null, view: "sql" },
        ],
      },
    },
  });
});

describe("QueryBuilderTab", () => {
  it("previews every card that composes, read only, with the sampled count", async () => {
    mount();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const req = preview.mock.calls[0][1] as SqlBuilderPreviewRequest;
    expect(req.targets.map((t) => t.clause_id)).toEqual(["f", "w"]);
    expect(req.table).toBe("orders");
    expect(req.probe_sql).toMatch(/LIMIT 1001/);
    expect(await screen.findAllByText(/37 of first/)).toHaveLength(2);
    expect(screen.getAllByText("sampled").length).toBeGreaterThan(0);
    expect(screen.getByText("Empty, skipped")).toBeInTheDocument();
    // The WHERE form shows its condition row.
    expect(screen.getByDisplayValue("total")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });

  it("runs the whole query read only", async () => {
    runStream.mockResolvedValue({
      columns: ["id"],
      rows: [],
      rows_affected: 0,
      is_select: true,
      error: null,
      elapsed_ms: 4,
    });
    mount();
    const run = await screen.findByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    await act(async () => run.click());
    expect(runStream).toHaveBeenCalled();
    const [, sql, , , , , readOnly] = runStream.mock.calls[0];
    expect(sql).toBe("SELECT * FROM orders WHERE total > 5");
    expect(readOnly).toBe(true);
  });

  it("holds Run and Copy back while a card fails", async () => {
    useStudioStore.setState((s) => ({
      queryBuilderTabs: {
        [KEY]: {
          ...s.queryBuilderTabs[KEY],
          clauses: [
            {
              id: "f",
              kind: "from",
              body: "orders",
              aggregates: null,
              view: "sql",
            },
            {
              id: "w",
              kind: "where",
              body: "total >> AND",
              aggregates: null,
              view: "sql",
            },
          ],
        },
      },
    }));
    mount();
    // Cards stay hidden until React Flow measures them, which jsdom never
    // does, so the card's alert is found by its text.
    expect(await screen.findByText(/Syntax Error/)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Copy SQL/ })).toBeDisabled();
  });
});
