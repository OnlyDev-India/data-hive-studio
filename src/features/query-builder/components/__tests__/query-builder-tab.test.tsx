import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

import {
  useStudioStore,
  type BuilderQuery,
  type Clause,
  type StudioStore,
} from "@/shared/store";
import { DEFAULT_QUERY_BUILDER_SETUP } from "@/shared/store/types";
import { EMPTY_HISTORY, setHistory } from "@/shared/components/builder-canvas";
import { ThemeProvider } from "@/shared/theme/theme";

const KEY = "query-builder:c1:0";

const card = (
  id: string,
  kind: Clause["kind"],
  body: string,
  view: Clause["view"] = "form",
): Clause => ({ id, kind, body, aggregates: null, view });

const query = (
  id: string,
  clauses: Clause[],
  kind: BuilderQuery["kind"] = "select",
) => ({ id, kind, name: null, clauses });

const withQueries = (queries: BuilderQuery[]) =>
  useStudioStore.setState((s) => ({
    queryBuilderTabs: {
      [KEY]: {
        ...s.queryBuilderTabs[KEY],
        queries,
        picked_query_ids: [queries[0].id],
      },
    },
  }));
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
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  setHistory(KEY, EMPTY_HISTORY);
  preview.mockReset();
  runStream.mockReset();
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
        queries: [
          query("q1", [
            card("s", "select", "", "sql"),
            card("f", "from", "orders"),
            card("w", "where", "total > 5"),
            card("l", "limit", "", "sql"),
          ]),
        ],
        picked_query_ids: ["q1"],
      },
    },
  });
});

describe("QueryBuilderTab", () => {
  it("previews every card that composes, read only, with the sampled count", async () => {
    mount();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const req = preview.mock.calls[0][1] as SqlBuilderPreviewRequest;
    // Run order, with the SELECT card's whole query last.
    expect(req.targets.map((t) => t.clause_id)).toEqual(["f", "w", "s"]);
    expect(req.targets[2].sql).toBe(req.targets[1].sql);
    expect(req.table).toBe("orders");
    expect(req.probe_sql).toMatch(/LIMIT 1001/);
    expect(await screen.findAllByText(/37 of first/)).toHaveLength(3);
    expect(screen.getAllByText("sampled").length).toBeGreaterThan(0);
    expect(screen.getByText("Empty, skipped")).toBeInTheDocument();
    // The WHERE form shows its condition row.
    expect(screen.getByDisplayValue("total")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  });

  it("opens the table picker from the FROM form", async () => {
    mount();
    // React Flow keeps unmeasured nodes hidden in jsdom, so find by text.
    const pick = (await screen.findByText("orders")).closest("button")!;
    expect(pick).toHaveAttribute("aria-haspopup");
    await act(async () => pick.click());
    expect(
      await screen.findByPlaceholderText("Find a table…"),
    ).toBeInTheDocument();
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

  it("holds Copy back while a card fails, and Run names the query", async () => {
    useStudioStore.setState((s) => ({
      queryBuilderTabs: {
        [KEY]: {
          ...s.queryBuilderTabs[KEY],
          queries: [
            query("q1", [
              card("s", "select", "", "sql"),
              card("f", "from", "orders", "sql"),
              card("w", "where", "total >> AND", "sql"),
            ]),
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
    expect(screen.getByRole("button", { name: /Copy SQL/ })).toBeDisabled();
    const push = vi.spyOn(useStudioStore.getState(), "pushNotification");
    await act(async () => screen.getByRole("button", { name: "Run" }).click());
    expect(runStream).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.stringMatching(/SELECT orders/),
      }),
    );
  });

  it("previews only the current query and refreshes another once picked", async () => {
    useStudioStore.setState((s) => ({
      queryBuilderTabs: {
        [KEY]: {
          ...s.queryBuilderTabs[KEY],
          queries: [
            query("q1", [
              card("s", "select", "", "sql"),
              card("f", "from", "orders"),
            ]),
            query("q2", [
              card("s2", "select", "", "sql"),
              card("f2", "from", "customers"),
            ]),
          ],
          picked_query_ids: ["q1"],
        },
      },
    }));
    mount();
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
    const first = preview.mock.calls[0][1] as SqlBuilderPreviewRequest;
    expect(first.targets.map((t) => t.clause_id)).toEqual(["f", "s"]);

    const header = await screen.findByText("SELECT customers");
    await act(async () => header.click());
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
    const second = preview.mock.calls[1][1] as SqlBuilderPreviewRequest;
    expect(second.targets.map((t) => t.clause_id)).toEqual(["f2", "s2"]);
    expect(
      useStudioStore.getState().queryBuilderTabs[KEY].picked_query_ids,
    ).toEqual(["q2"]);
    // The first query keeps its previews, marked stale.
    expect(await screen.findAllByText("Stale")).toHaveLength(2);
  });

  it("runs every query in turn, and an error leaves the rest not run", async () => {
    useStudioStore.setState((s) => ({
      queryBuilderTabs: {
        [KEY]: {
          ...s.queryBuilderTabs[KEY],
          queries: [
            query(
              "q1",
              [card("x", "statement", "CREATE TABLE t (a int)")],
              "statement",
            ),
            query("q2", [
              card("s", "select", "", "sql"),
              card("f", "from", "orders"),
            ]),
            query("q3", [card("y", "statement", "DROP TABLE t")], "statement"),
          ],
          picked_query_ids: ["q2"],
        },
      },
    }));
    runStream
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        rows_affected: 0,
        is_select: false,
        error: null,
        elapsed_ms: 1,
      })
      .mockResolvedValueOnce({
        columns: [],
        rows: [],
        rows_affected: 0,
        is_select: true,
        error: "no such table: orders",
        elapsed_ms: 1,
      });
    mount();
    const all = await screen.findByRole("button", { name: /Run all/ });
    await act(async () => all.click());
    // DROP asks first; confirm it.
    const confirm = await screen.findByRole("button", { name: /Run anyway/ });
    await act(async () => confirm.click());
    await waitFor(() => expect(runStream).toHaveBeenCalledTimes(2));
    const calls = runStream.mock.calls.map((c) => [c[1], c[6]]);
    expect(calls).toEqual([
      ["CREATE TABLE t (a int)", false],
      ["SELECT * FROM orders", true],
    ]);
    // A result tab per run query, the last one not run.
    expect(
      await screen.findByRole("radio", { name: "SQL statement: DROP" }),
    ).toBeInTheDocument();
    await act(async () =>
      screen.getByRole("radio", { name: "SQL statement: DROP" }).click(),
    );
    expect(await screen.findAllByText(/Not run/)).not.toHaveLength(0);
  });

  it("skips a bind variable card's preview and asks for it on Run", async () => {
    useStudioStore.setState((s) => ({
      queryBuilderTabs: {
        [KEY]: {
          ...s.queryBuilderTabs[KEY],
          queries: [
            query("q1", [
              card("s", "select", "", "sql"),
              card("f", "from", "orders"),
              card("w", "where", "id = :id", "sql"),
            ]),
          ],
          picked_query_ids: ["q1"],
        },
      },
    }));
    mount();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const req = preview.mock.calls[0][1] as SqlBuilderPreviewRequest;
    expect(req.targets.map((t) => t.clause_id)).toEqual(["f"]);
    expect(
      await screen.findByText("Needs a value, asked on Run"),
    ).toBeInTheDocument();
    await act(async () => screen.getByRole("button", { name: "Run" }).click());
    expect(await screen.findByText("Bind variables")).toBeInTheDocument();
    expect(runStream).not.toHaveBeenCalled();
  });

  it("never previews a write query, and runs it like the editor", async () => {
    withQueries([
      query(
        "q1",
        [
          card("u", "update", "orders"),
          card("t", "set", "total = 0"),
          card("w", "where", "id = 1", "sql"),
          card("r", "returning", "id", "sql"),
        ],
        "update",
      ),
    ]);
    runStream.mockResolvedValue({
      columns: ["id"],
      rows: [["1"]],
      rows_affected: 1,
      is_select: false,
      error: null,
      elapsed_ms: 2,
    });
    mount();
    expect(await screen.findAllByText("Write query, no preview")).toHaveLength(
      4,
    );
    // The SET form shows its row.
    expect(screen.getByDisplayValue("total")).toBeInTheDocument();
    const run = screen.getByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    await act(async () => run.click());
    await waitFor(() => expect(runStream).toHaveBeenCalled());
    const [, sql, , , , , readOnly] = runStream.mock.calls[0];
    expect(sql).toBe("UPDATE orders SET total = 0 WHERE id = 1 RETURNING id");
    expect(readOnly).toBe(false);
    expect(preview).not.toHaveBeenCalled();
  });

  it("asks the editor's confirm before an UPDATE with no WHERE", async () => {
    withQueries([
      query(
        "q1",
        [card("u", "update", "orders"), card("t", "set", "total = 0", "sql")],
        "update",
      ),
    ]);
    mount();
    const run = await screen.findByRole("button", { name: "Run" });
    await waitFor(() => expect(run).toBeEnabled());
    await act(async () => run.click());
    expect(
      await screen.findByRole("button", { name: /Run anyway/ }),
    ).toBeInTheDocument();
    expect(runStream).not.toHaveBeenCalled();
  });

  it("adds the kind of query picked from + Query", async () => {
    mount();
    const add = (await screen.findByText("Query")).closest("button")!;
    await act(async () => add.click());
    await act(async () =>
      (await screen.findByRole("menuitem", { name: /Upsert/ })).click(),
    );
    const qs = useStudioStore.getState().queryBuilderTabs[KEY].queries;
    expect(qs).toHaveLength(2);
    expect(qs[1].kind).toBe("insert");
    expect(qs[1].clauses.map((c) => c.kind)).toEqual([
      "insert",
      "values",
      "conflict",
    ]);
    // The new column's header: its label and its kind badge.
    expect(await screen.findAllByText("UPSERT")).toHaveLength(2);
  });

  it("previews a subquery's cards and collapses it to a chip", async () => {
    withQueries([
      query("q1", [
        card("s", "select", "", "sql"),
        card("f", "from", "orders"),
        {
          ...card("w", "where", "id IN __dh_sub_1", "sql"),
          chains: [
            {
              id: "ch",
              marker: 1,
              name: null,
              collapsed: false,
              clauses: [
                card("cs", "select", "id", "sql"),
                card("cf", "from", "orders"),
              ],
            },
          ],
        },
      ]),
    ]);
    mount();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const req = preview.mock.calls[0][1] as SqlBuilderPreviewRequest;
    expect(req.targets.map((t) => t.clause_id)).toEqual(
      expect.arrayContaining(["cf", "cs", "w", "s"]),
    );
    expect(req.targets.find((t) => t.clause_id === "w")!.sql).toMatch(
      /WHERE id IN \(SELECT id FROM \(SELECT \* FROM orders LIMIT 1000\) AS orders\)/,
    );
    // Its parent's SQL view shows it inline.
    expect(
      await screen.findByText(/Subquery in WHERE, card 3/),
    ).toBeInTheDocument();
    const collapse = screen.getByLabelText("Collapse subquery");
    await act(async () => collapse.click());
    const chain =
      useStudioStore.getState().queryBuilderTabs[KEY].queries[0].clauses[2]
        .chains![0];
    expect(chain.collapsed).toBe(true);
    expect(
      await screen.findByText(/subquery on orders, 2 cards/),
    ).toBeInTheDocument();
  });

  it("previews a write query's subquery, never its own cards", async () => {
    withQueries([
      query(
        "q1",
        [
          card("u", "update", "orders"),
          {
            ...card("t", "set", "total = __dh_sub_1", "sql"),
            chains: [
              {
                id: "ch",
                marker: 1,
                name: null,
                collapsed: false,
                clauses: [
                  card("cs", "select", "MAX(total)", "sql"),
                  card("cf", "from", "orders"),
                ],
              },
            ],
          },
          card("w", "where", "id = 1", "sql"),
        ],
        "update",
      ),
    ]);
    mount();
    await waitFor(() => expect(preview).toHaveBeenCalled());
    const req = preview.mock.calls[0][1] as SqlBuilderPreviewRequest;
    const ids = req.targets.map((t) => t.clause_id);
    expect(ids).toEqual(expect.arrayContaining(["cf", "cs"]));
    expect(ids).not.toContain("t");
    expect(ids).not.toContain("u");
    expect(
      screen.getAllByText("Write query, no preview").length,
    ).toBeGreaterThan(0);
  });

  it("searches every query, opens a collapsed chain on screen, and steps through matches", async () => {
    withQueries([
      query("q1", [
        card("s", "select", "", "sql"),
        card("f", "from", "orders"),
      ]),
      query("q2", [
        card("s2", "select", "", "sql"),
        card("f2", "from", "customers"),
        {
          ...card("w2", "where", "id IN __dh_sub_1", "sql"),
          chains: [
            {
              id: "ch",
              marker: 1,
              name: null,
              collapsed: true,
              clauses: [
                card("cs", "select", "customer_id", "sql"),
                card("cf", "from", "orders"),
                card("cw", "where", "total > 5", "sql"),
              ],
            },
          ],
        },
      ]),
      query("q3", [card("x", "statement", "VACUUM")], "statement"),
    ]);
    mount();
    const box = await screen.findByLabelText("Search queries");
    await act(async () => {
      fireEvent.change(box, { target: { value: "ORDERS.total" } });
    });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    // Shown open while it holds a match, still collapsed in the setup.
    expect(screen.getByLabelText("Collapse subquery")).toBeInTheDocument();
    const tab = () => useStudioStore.getState().queryBuilderTabs[KEY];
    expect(tab().queries[1].clauses[2].chains![0].collapsed).toBe(true);
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(box, { target: { value: "orders" } });
    });
    // The SELECT orders header, its FROM, and the subquery and its FROM.
    expect(screen.getByText("4 matches")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    });
    expect(screen.getByText("4 of 4")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Escape" });
    });
    expect(box).toHaveValue("");
    expect(screen.getByLabelText("Expand subquery")).toBeInTheDocument();
    expect(JSON.stringify(tab())).not.toMatch(/ORDERS\.total/);
  });

  it("undoes a query add over the whole tab, never a collapse", async () => {
    withQueries([
      query("q1", [
        card("s", "select", "", "sql"),
        card("f", "from", "orders"),
        {
          ...card("w", "where", "id IN __dh_sub_1", "sql"),
          chains: [
            {
              id: "ch",
              marker: 1,
              name: null,
              collapsed: false,
              clauses: [
                card("cs", "select", "id", "sql"),
                card("cf", "from", "orders"),
              ],
            },
          ],
        },
      ]),
    ]);
    mount();
    const undo = await screen.findByLabelText("Undo");
    expect(undo).toBeDisabled();
    await act(async () => screen.getByLabelText("Collapse subquery").click());
    expect(undo).toBeDisabled();
    const add = (await screen.findByText("Query")).closest("button")!;
    await act(async () => add.click());
    await act(async () =>
      (await screen.findByRole("menuitem", { name: /SELECT/ })).click(),
    );
    const tab = () => useStudioStore.getState().queryBuilderTabs[KEY];
    expect(tab().queries).toHaveLength(2);
    await act(async () => undo.click());
    expect(tab().queries).toHaveLength(1);
    expect(tab().picked_query_ids).toEqual(["q1"]);
    expect(tab().queries[0].clauses[2].chains![0].collapsed).toBe(true);
  });

  it("keeps a new condition's column box while you type in it", async () => {
    withQueries([
      query("q1", [
        card("s", "select", "", "sql"),
        card("f", "from", "orders"),
        card("w", "where", ""),
      ]),
    ]);
    mount();
    await act(async () =>
      (await screen.findByText("Add condition")).closest("button")!.click(),
    );
    const box = screen.getByLabelText("column") as HTMLInputElement;
    await act(async () => fireEvent.change(box, { target: { value: "t" } }));
    expect(box.isConnected).toBe(true);
    await act(async () => fireEvent.change(box, { target: { value: "tot" } }));
    expect(box.isConnected).toBe(true);
    expect(
      useStudioStore.getState().queryBuilderTabs[KEY].queries[0].clauses[2]
        .body,
    ).toBe("tot = ''");
  });
});
