import { describe, expect, it } from "vitest";
import type { SessionRow } from "@/shared/api";
import {
  displayDuration,
  filterSessions,
  firstLine,
  formatDuration,
  isSlow,
  rowActions,
  slowCount,
  type MonitorFilters,
} from "../sessions";

function row(p: Partial<SessionRow> & Pick<SessionRow, "id">): SessionRow {
  return {
    user: "app",
    database: "shop",
    state: "active",
    query_ms: 100,
    xact_ms: null,
    backend_start: "2026-10-14 09:00:00.1+00",
    wait: null,
    op_type: null,
    query: "SELECT 1",
    query_hidden: false,
    client: "10.0.0.5:51234",
    app_name: "psql",
    is_this_app: false,
    shard: null,
    run_id: null,
    can_cancel: true,
    can_terminate: true,
    ...p,
  };
}

const ALL: MonitorFilters = {
  database: null,
  user: null,
  state: "all",
  search: "",
};

const ids = (rows: SessionRow[]) => rows.map((r) => r.id);

describe("filterSessions", () => {
  const rows = [
    row({ id: "1", query_ms: 10 }),
    row({ id: "2", state: "idle", query_ms: null }),
    row({ id: "3", state: "idle_in_tx", query_ms: 5, xact_ms: 90_000 }),
    row({ id: "4", query_ms: 4000, database: "crm", user: "bob" }),
    row({
      id: "5",
      state: "waiting",
      query_ms: 700,
      query: "UPDATE orders SET x = 1",
      app_name: "billing-worker",
    }),
  ];

  it("hides plain idle by default, always shows idle in transaction, and sorts longest first (AC-4, AC-5)", () => {
    expect(ids(filterSessions(rows, ALL, false))).toEqual(["3", "4", "5", "1"]);
    expect(ids(filterSessions(rows, ALL, true))).toEqual([
      "3",
      "4",
      "5",
      "1",
      "2",
    ]);
  });

  it("picking the idle state shows idle sessions even with Show idle off", () => {
    expect(ids(filterSessions(rows, { ...ALL, state: "idle" }, false))).toEqual([
      "2",
    ]);
  });

  it("filters by database, user and state", () => {
    expect(ids(filterSessions(rows, { ...ALL, database: "crm" }, true))).toEqual([
      "4",
    ]);
    expect(ids(filterSessions(rows, { ...ALL, user: "bob" }, true))).toEqual(["4"]);
    expect(
      ids(filterSessions(rows, { ...ALL, state: "waiting" }, true)),
    ).toEqual(["5"]);
  });

  it("searches the query, app name and client, ignoring case", () => {
    expect(ids(filterSessions(rows, { ...ALL, search: "orders" }, true))).toEqual([
      "5",
    ]);
    expect(
      ids(filterSessions(rows, { ...ALL, search: "BILLING" }, true)),
    ).toEqual(["5"]);
    expect(
      filterSessions(rows, { ...ALL, search: "10.0.0.5" }, true),
    ).toHaveLength(5);
  });
});

describe("durations and the slow limit", () => {
  it("uses the transaction's age for idle in transaction and nothing for idle (AC-5)", () => {
    expect(displayDuration(row({ id: "a", query_ms: 7 }))).toBe(7);
    expect(
      displayDuration(row({ id: "b", state: "idle_in_tx", query_ms: 7, xact_ms: 60 })),
    ).toBe(60);
    expect(displayDuration(row({ id: "c", state: "idle", query_ms: 7 }))).toBeNull();
  });

  it("tints only active rows at or past the limit (AC-6)", () => {
    expect(isSlow(row({ id: "a", query_ms: 5000 }), 5000)).toBe(true);
    expect(isSlow(row({ id: "b", query_ms: 4999 }), 5000)).toBe(false);
    expect(
      isSlow(row({ id: "c", state: "waiting", query_ms: 90_000 }), 5000),
    ).toBe(false);
    expect(
      slowCount(
        [row({ id: "a", query_ms: 6000 }), row({ id: "b", query_ms: 1000 })],
        500,
      ),
    ).toBe(2);
  });

  it("formats durations the way the list shows them", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(4200)).toBe("4.2s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
    expect(firstLine("\n  -- note\nSELECT 1\nFROM t")).toBe("-- note");
    expect(firstLine(null)).toBe("");
    expect(firstLine('{\n  "find": "orders",\n  "filter": {\n    "status": "open"\n  }\n}')).toBe(
      '{ "find": "orders", "filter": { "status": "open" } }',
    );
  });
});

describe("rowActions", () => {
  const labels = (r: SessionRow, engine: "postgres" | "mongodb", locked = false) =>
    rowActions(r, engine, locked).map((a) => [a.label, a.enabled]);

  it("offers Cancel on running Postgres rows and Terminate on any row (AC-12)", () => {
    expect(labels(row({ id: "1" }), "postgres")).toEqual([
      ["Cancel query", true],
      ["Terminate session", true],
    ]);
    expect(labels(row({ id: "2", state: "idle_in_tx" }), "postgres")).toEqual([
      ["Terminate session", true],
    ]);
  });

  it("offers Kill operation only on a running Mongo operation", () => {
    expect(labels(row({ id: "9" }), "mongodb")).toEqual([["Kill operation", true]]);
    expect(labels(row({ id: "lsid:x", state: "idle" }), "mongodb")).toEqual([]);
  });

  it("names the missing privilege when the user may not kill (AC-15)", () => {
    const [cancel] = rowActions(row({ id: "1", can_cancel: false }), "postgres", false);
    expect(cancel.enabled).toBe(false);
    expect(cancel.reason).toMatch(/pg_signal_backend/);
    const [mongo] = rowActions(row({ id: "9", can_cancel: false }), "mongodb", false);
    expect(mongo.reason).toMatch(/killop/);
  });

  it("turns every kill off on a read only team server (AC-14)", () => {
    const actions = rowActions(row({ id: "1" }), "postgres", true);
    expect(actions.every((a) => !a.enabled)).toBe(true);
    expect(actions[0].reason).toBe("This server is read only");
  });
});
