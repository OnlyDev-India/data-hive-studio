import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StudioTab } from "@/shared/store";
import { TabBar } from "../tab-bar";

const users: StudioTab = { kind: "table", name: "users", tabId: 1 };
const orders: StudioTab = { kind: "table", name: "orders", tabId: 2 };

function renderBar(tabs: StudioTab[]) {
  const on_close_others = vi.fn();
  const noop = () => {};
  render(
    <TabBar
      paneId="root"
      is_mongo={false}
      tabs={tabs}
      active={tabs[0]}
      dirty_keys={new Set()}
      on_select={noop}
      on_close={noop}
      on_drag_start={noop}
      on_close_all={noop}
      on_close_to_left={noop}
      on_close_to_right={noop}
      on_close_others={on_close_others}
      on_new_sql={noop}
      on_new_table={noop}
      on_new_mongo_console={noop}
      on_open_file={noop}
      on_split_right={noop}
      on_split_down={noop}
    />,
  );
  return on_close_others;
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("tab context menu", () => {
  it("closes the other tabs, keeping the one clicked", async () => {
    const on_close_others = renderBar([users, orders]);
    fireEvent.contextMenu(screen.getByText("orders"));
    fireEvent.click(await screen.findByText("Close others"));
    expect(on_close_others).toHaveBeenCalledWith(orders);
  });

  it("disables Close others when it is the only tab", async () => {
    renderBar([users]);
    fireEvent.contextMenu(screen.getByText("users"));
    const item = await screen.findByText("Close others");
    expect(item.closest("[data-disabled]")).not.toBeNull();
  });
});
