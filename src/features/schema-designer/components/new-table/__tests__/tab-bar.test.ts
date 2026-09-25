import { describe, expect, it } from "vitest";
import { arrangeTabs } from "../tab-bar";

const order = ["a", "b", "c", "d", "e"] as const;
const widths = { a: 60, b: 60, c: 60, d: 60, e: 60 };

describe("arrangeTabs", () => {
  it("shows every tab when they all fit", () => {
    expect(arrangeTabs(order, widths, 400, "a")).toEqual({
      visible: [...order],
      hidden: [],
    });
  });

  it("moves the tabs that do not fit into the dropdown", () => {
    const r = arrangeTabs(order, widths, 200, "a");
    expect(r.visible).toEqual(["a", "b"]);
    expect(r.hidden).toEqual(["c", "d", "e"]);
  });

  it("swaps a hidden selected tab with the last visible one", () => {
    const r = arrangeTabs(order, widths, 200, "d");
    expect(r.visible).toEqual(["a", "d"]);
    expect(r.hidden).toEqual(["b", "c", "e"]);
  });

  it("always keeps one tab visible", () => {
    const r = arrangeTabs(order, widths, 10, "a");
    expect(r.visible).toEqual(["a"]);
  });
});
