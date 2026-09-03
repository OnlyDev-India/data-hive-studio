import { describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { schemaDesignerActions } from "./schema-designer-slice";

function makeStore() {
  return create<ReturnType<typeof schemaDesignerActions>>()((set) =>
    schemaDesignerActions(set),
  );
}

describe("schemaDesignerActions", () => {
  it("setSchemaEdit/clearSchemaEdit register and remove by key", () => {
    const store = makeStore();
    const handle = { count: 2, busy: false, apply: vi.fn(), discard: vi.fn() };
    store.getState().setSchemaEdit("tab1", handle);
    expect(store.getState().schemaEdits.tab1).toBe(handle);
    store.getState().clearSchemaEdit("tab1");
    expect(store.getState().schemaEdits.tab1).toBeUndefined();
  });

  it("setSchemaPane/clearSchemaPane register and remove by key", () => {
    const store = makeStore();
    const handle = { busy: false, refresh: vi.fn(), drop: vi.fn() };
    store.getState().setSchemaPane("pane1", handle);
    expect(store.getState().schemaPanes.pane1).toBe(handle);
    store.getState().clearSchemaPane("pane1");
    expect(store.getState().schemaPanes.pane1).toBeUndefined();
  });

  it("setNewTable/clearNewTable register and remove by key, independent of other keys", () => {
    const store = makeStore();
    const a = { create: vi.fn(), creating: false, valid: true, has_draft: true };
    const b = { create: vi.fn(), creating: false, valid: false, has_draft: false };
    store.getState().setNewTable("a", a);
    store.getState().setNewTable("b", b);
    store.getState().clearNewTable("a");
    expect(store.getState().newTables.a).toBeUndefined();
    expect(store.getState().newTables.b).toBe(b);
  });
});
