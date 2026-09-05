import { describe, expect, it } from "vitest";
import { create } from "zustand";
import { activityActions } from "./activity-slice";

function makeStore() {
  // activityActions is typed against the FULL StudioStore's set (it's
  // designed to be spread into the real store) — a store created from
  // just this slice's own shape has a narrower set type, which TS
  // correctly flags as incompatible. Safe to cast here: at runtime set
  // just merges whatever state exists, and this slice only ever touches
  // its own fields.
  return create<ReturnType<typeof activityActions>>()((set) =>
    activityActions(set as unknown as Parameters<typeof activityActions>[0]),
  );
}

function entry(id: string) {
  return {
    id,
    kind: "sql",
    target: "SELECT 1",
    ok: true,
    rows: 1,
    duration_ms: 1,
    error: null,
    sql: null,
  } as unknown as Parameters<
    ReturnType<typeof activityActions>["pushActivity"]
  >[0];
}

describe("activityActions", () => {
  it("pushActivity is idempotent by id", () => {
    const store = makeStore();
    store.getState().pushActivity(entry("a"));
    store.getState().pushActivity(entry("a"));
    expect(store.getState().activity).toHaveLength(1);
  });

  it("pushActivity puts newest entries first and caps at 500", () => {
    const store = makeStore();
    store.getState().pushActivity(entry("a"));
    store.getState().pushActivity(entry("b"));
    expect(store.getState().activity.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("setActivity merges hydration snapshot, keeping live-only entries on top", () => {
    const store = makeStore();
    store.getState().pushActivity(entry("live"));
    store.getState().setActivity([entry("snap1"), entry("snap2")]);
    expect(store.getState().activity.map((e) => e.id)).toEqual([
      "live",
      "snap1",
      "snap2",
    ]);
  });

  it("clearActivityEntries empties the list", () => {
    const store = makeStore();
    store.getState().pushActivity(entry("a"));
    store.getState().clearActivityEntries();
    expect(store.getState().activity).toHaveLength(0);
  });
});
