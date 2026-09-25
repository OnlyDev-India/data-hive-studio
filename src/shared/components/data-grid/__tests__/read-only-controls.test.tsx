import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { useStudioStore, type GridBridge } from "@/shared/store";
import { GridActionBar } from "../grid-action-bar";
import { SchemaActionBar } from "../schema-action-bar";

// The toolbars measure their pane with a ResizeObserver, which jsdom lacks.
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
});

const REASON = /read only connection/i;

function bridge(over: Partial<GridBridge> = {}): GridBridge {
  return {
    rows: 2,
    total: 2,
    loading: false,
    total_pages: 1,
    page: 0,
    set_page: () => {},
    page_size: 50,
    set_page_size: () => {},
    selected_cell_count: 1,
    editable: true,
    table: "users",
    bulk_edit_selection: () => {},
    all_columns: [],
    hidden_columns: [],
    toggle_column_visibility: () => {},
    reorder_column: () => {},
    reveal_column: () => {},
    elapsed_ms: null,
    pending_exists: false,
    pending_count: 0,
    start_pending: () => {},
    apply_pending: () => {},
    cancel_pending: () => {},
    get_pending_sql: () => "",
    get_pending_changes: () => [],
    delete_rows: () => {},
    refresh: () => {},
    get_export: () => null,
    get_filtered_op: () => ({ kind: "select", table: "users" }),
    ...over,
  } as GridBridge;
}

const bulk_edit = { columns: [], distinct: {} };
const conn = (over: Record<string, unknown> = {}) =>
  useStudioStore.setState({
    open: [{ id: "c1", name: "orders", kind: "postgres", ...over }],
  } as never);

describe("GridActionBar on a read only connection", () => {
  it("disables Add Row, Delete Row(s) and Bulk Edit, and says why", () => {
    conn({ read_only: true });
    render(
      <GridActionBar
        bridge={bridge({ editable: false, read_only: true })}
        conn_id="c1"
        pane_ref={createRef()}
        bulk_edit={bulk_edit}
      />,
    );

    for (const name of ["Add Row", "Delete Row(s)", "Bulk Edit"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button.closest("span[title]")).toHaveAttribute(
        "title",
        expect.stringMatching(REASON),
      );
    }
  });

  it("keeps the reading controls on: Refresh and Columns", () => {
    conn({ read_only: true });
    render(
      <GridActionBar
        bridge={bridge({ editable: false, read_only: true })}
        conn_id="c1"
        pane_ref={createRef()}
      />,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Columns" })).toBeEnabled();
  });

  it("leaves the write buttons on for an ordinary connection", () => {
    conn();
    render(
      <GridActionBar
        bridge={bridge()}
        conn_id="c1"
        pane_ref={createRef()}
        bulk_edit={bulk_edit}
      />,
    );
    expect(screen.getByRole("button", { name: "Add Row" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Bulk Edit" })).toBeEnabled();
  });

  it("gives no reason for a table that is simply not editable, like a view", () => {
    conn();
    render(
      <GridActionBar
        bridge={bridge({ editable: false })}
        conn_id="c1"
        pane_ref={createRef()}
      />,
    );
    const add = screen.getByRole("button", { name: "Add Row" });
    expect(add).toBeDisabled();
    expect(add.closest("span[title]")).toBeNull();
  });
});

describe("SchemaActionBar on a read only connection", () => {
  const edit = {
    count: 2,
    busy: false,
    apply: vi.fn(),
    review: vi.fn(),
    discard: vi.fn(),
  };
  const pane = { busy: false, refresh: vi.fn(), drop: vi.fn() };

  it("disables Drop and Review, with the reason as the tooltip", () => {
    conn({ read_only: true });
    render(
      <SchemaActionBar
        schemaEdit={edit}
        schemaPane={pane}
        drop_label="Drop table"
        pane_ref={createRef()}
        conn_id="c1"
      />,
    );
    const drop = screen.getByRole("button", { name: "Drop table" });
    expect(drop).toBeDisabled();
    expect(drop).toHaveAttribute(
      "title",
      expect.stringMatching(/schema changes are refused/i),
    );
    expect(screen.getByRole("button", { name: /review/i })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /pending schema changes options/i }),
    ).toBeDisabled();
    // Reading still works.
    expect(
      screen.getByRole("button", { name: "Refresh schema" }),
    ).toBeEnabled();
  });

  it("leaves them on for an ordinary connection", () => {
    conn();
    render(
      <SchemaActionBar
        schemaEdit={edit}
        schemaPane={pane}
        drop_label="Drop table"
        pane_ref={createRef()}
        conn_id="c1"
      />,
    );
    expect(screen.getByRole("button", { name: "Drop table" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /review/i })).toBeEnabled();
  });
});
