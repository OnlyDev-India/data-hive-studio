import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useGridController,
  type GridControllerConfig,
} from "../grid-controller";
import { cellKey } from "../grid-context";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    // @ts-expect-error -- minimal stub, only `observe`/`disconnect` are called
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  }
});

function baseConfig(
  overrides: Partial<GridControllerConfig> = {},
): GridControllerConfig {
  return {
    rows: [
      ["1", "a"],
      ["2", "b"],
    ],
    columns: ["id", "name"],
    row_offset: 0,
    editable: true,
    pk_columns: [],
    conn_id: "c1",
    table: "t",
    kinds: {},
    distinct: {},
    on_modified: () => {},
    on_set_null: () => {},
    on_delete_row: () => {},
    ...overrides,
  };
}

describe("useGridController — generate_values", () => {
  it("routes 'null' through on_set_null, not write_cell/on_edit_cell", () => {
    const on_set_null = vi.fn();
    const on_edit_cell = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_set_null, on_edit_cell })),
    );
    act(() => {
      result.current.on_select(new Set([cellKey(0, "name")]));
    });
    act(() => {
      result.current.generate_values("null");
    });
    expect(on_set_null).toHaveBeenCalledWith(0, "name");
    expect(on_edit_cell).not.toHaveBeenCalled();
  });

  it("'increment' continues from the first row-major cell's own value", () => {
    const on_edit_cell = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_edit_cell })),
    );
    // Selected out of row-major order on purpose — application order must
    // still be row 0 then row 1, not selection/insertion order.
    act(() => {
      result.current.on_select(new Set([cellKey(1, "id"), cellKey(0, "id")]));
    });
    act(() => {
      result.current.generate_values("increment");
    });
    expect(on_edit_cell).toHaveBeenNthCalledWith(1, 0, "id", "1");
    expect(on_edit_cell).toHaveBeenNthCalledWith(2, 1, "id", "2");
  });

  it("'uuid' writes a distinct value per selected cell", () => {
    const on_edit_cell = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_edit_cell })),
    );
    act(() => {
      result.current.on_select(
        new Set([cellKey(0, "name"), cellKey(1, "name")]),
      );
    });
    act(() => {
      result.current.generate_values("uuid");
    });
    expect(on_edit_cell).toHaveBeenCalledTimes(2);
    const [v1] = on_edit_cell.mock.calls[0].slice(2);
    const [v2] = on_edit_cell.mock.calls[1].slice(2);
    expect(v1).not.toBe(v2);
    expect(v1).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("no-ops on an empty selection", () => {
    const on_edit_cell = vi.fn();
    const on_set_null = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_edit_cell, on_set_null })),
    );
    act(() => {
      result.current.generate_values("now");
    });
    expect(on_edit_cell).not.toHaveBeenCalled();
    expect(on_set_null).not.toHaveBeenCalled();
  });
});

describe("useGridController — row actions act on every row the selection touches", () => {
  it("menu_delete deletes every row with a selected cell, not just the clicked one", () => {
    const on_delete_row = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_delete_row })),
    );
    // Only one cell selected per row — neither row is FULLY selected.
    act(() => {
      result.current.on_select(new Set([cellKey(0, "id"), cellKey(1, "name")]));
    });
    act(() => {
      result.current.menu_delete(1);
    });
    expect(on_delete_row).toHaveBeenCalledTimes(2);
    expect(on_delete_row).toHaveBeenCalledWith(0);
    expect(on_delete_row).toHaveBeenCalledWith(1);
  });

  it("menu_delete routes a selected pending row through on_remove_pending, not on_delete_row", () => {
    const on_delete_row = vi.fn();
    const on_remove_pending = vi.fn();
    const { result } = renderHook(() =>
      useGridController(
        baseConfig({
          on_delete_row,
          on_remove_pending,
          pending_rows: [{ values: ["3", "c"], dirty: false }],
        }),
      ),
    );
    // Row 0 is now the pending draft; row 1 is a real row.
    act(() => {
      result.current.on_select(new Set([cellKey(0, "id"), cellKey(1, "id")]));
    });
    act(() => {
      result.current.menu_delete(1);
    });
    // Pending row 0 goes through on_remove_pending; real row 1 keeps the
    // convention `on_delete_row` already used (the grid index, not a
    // pending-adjusted "real" index — the host resolves that itself).
    expect(on_remove_pending).toHaveBeenCalledWith(0);
    expect(on_delete_row).toHaveBeenCalledWith(1);
    expect(on_delete_row).not.toHaveBeenCalledWith(0);
  });

  it("menu_delete falls back to just the clicked row when nothing is selected", () => {
    const on_delete_row = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_delete_row })),
    );
    act(() => {
      result.current.menu_delete(1);
    });
    expect(on_delete_row).toHaveBeenCalledTimes(1);
    expect(on_delete_row).toHaveBeenCalledWith(1);
  });

  it("menu_clone_row calls on_clone_row once with every touched row, not once per row", () => {
    const on_clone_row = vi.fn();
    const { result } = renderHook(() =>
      useGridController(baseConfig({ on_clone_row })),
    );
    act(() => {
      result.current.on_select(new Set([cellKey(1, "id"), cellKey(0, "name")]));
    });
    act(() => {
      // Non-null: `on_clone_row` was provided above, so the controller
      // always resolves `menu_clone_row` to a real function (it's only
      // ever `undefined` in the type because the config prop is optional).
      result.current.menu_clone_row!(1);
    });
    expect(on_clone_row).toHaveBeenCalledTimes(1);
    expect(on_clone_row).toHaveBeenCalledWith([0, 1]);
  });

  it("touched_row_count counts distinct rows, not selected cells", () => {
    const { result } = renderHook(() => useGridController(baseConfig()));
    act(() => {
      result.current.on_select(
        new Set([cellKey(0, "id"), cellKey(0, "name"), cellKey(1, "id")]),
      );
    });
    expect(result.current.touched_row_count).toBe(2);
  });
});

describe("useGridController — reorder_column", () => {
  const fourCols = () =>
    baseConfig({
      columns: ["a", "b", "c", "d"],
      rows: [["1", "2", "3", "4"]],
    });

  it("dragging onto the very next column still moves it (no insert-before cancellation)", () => {
    const { result } = renderHook(() => useGridController(fourCols()));
    act(() => result.current.reorder_column("a", "b"));
    expect(result.current.view.column_order).toEqual(["b", "a", "c", "d"]);
  });

  it("dragging rightward past several columns lands right after the target", () => {
    const { result } = renderHook(() => useGridController(fourCols()));
    act(() => result.current.reorder_column("a", "d"));
    expect(result.current.view.column_order).toEqual(["b", "c", "d", "a"]);
  });

  it("dragging leftward lands right before the target", () => {
    const { result } = renderHook(() => useGridController(fourCols()));
    act(() => result.current.reorder_column("d", "a"));
    expect(result.current.view.column_order).toEqual(["d", "a", "b", "c"]);
  });

  it("dragging onto the very previous column still moves it", () => {
    const { result } = renderHook(() => useGridController(fourCols()));
    act(() => result.current.reorder_column("d", "c"));
    expect(result.current.view.column_order).toEqual(["a", "b", "d", "c"]);
  });
});
