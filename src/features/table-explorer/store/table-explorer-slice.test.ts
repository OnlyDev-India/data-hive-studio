import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { tableExplorerActions } from "./table-explorer-slice";

function makeStore() {
  return create<ReturnType<typeof tableExplorerActions>>()((set) =>
    tableExplorerActions(set),
  );
}

describe("tableExplorerActions", () => {
  it("setMongoView sets the view mode for one tab key without affecting others", () => {
    const store = makeStore();
    store.getState().setMongoView("tab1", "json");
    store.getState().setMongoView("tab2", "grid");
    expect(store.getState().mongoViews).toEqual({ tab1: "json", tab2: "grid" });
  });

  it("setMongoView overwrites the mode for the same key", () => {
    const store = makeStore();
    store.getState().setMongoView("tab1", "grid");
    store.getState().setMongoView("tab1", "json");
    expect(store.getState().mongoViews.tab1).toBe("json");
  });
});
