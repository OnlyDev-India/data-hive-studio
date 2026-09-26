import { describe, expect, it } from "vitest";
import {
  DOCUMENTDB_DEFAULTS,
  MONGO_DEFAULTS,
  PG_DEFAULTS,
  SQLITE_DEFAULTS,
} from "../defaults";
import { tabChanged, tabsFor } from "../tab-fields";
import { firstErrorTab, validateForm } from "../validate-form";

const fields = (errs: { field: string }[]) => errs.map((e) => e.field);

describe("validateForm", () => {
  it("passes the PostgreSQL defaults", () => {
    expect(validateForm({ kind: "postgres", values: PG_DEFAULTS })).toEqual([]);
  });

  it("checks the port range", () => {
    for (const port of ["0", "65536", "54.3", "abc"]) {
      const errs = validateForm({
        kind: "postgres",
        values: { ...PG_DEFAULTS, port },
      });
      expect(fields(errs)).toEqual(["port"]);
    }
    expect(
      validateForm({ kind: "postgres", values: { ...PG_DEFAULTS, port: "" } }),
    ).toEqual([]);
  });

  it("skips the port while SRV is on", () => {
    const values = { ...MONGO_DEFAULTS, database: "app", srv: true, port: "x" };
    expect(validateForm({ kind: "mongodb", values })).toEqual([]);
  });

  it("needs a Mongo database and an SSH user", () => {
    const values = { ...MONGO_DEFAULTS, ssh_host: "bastion" };
    const errs = validateForm({ kind: "mongodb", values });
    expect(errs).toEqual([
      {
        tab: "connection",
        field: "database",
        message: "Database is required.",
      },
      { tab: "ssh", field: "ssh_user", message: "SSH user is required." },
    ]);
    expect(firstErrorTab("mongodb", errs)).toBe("connection");
  });

  it("needs a key file in key mode on desktop only", () => {
    const values = {
      ...PG_DEFAULTS,
      ssh_host: "bastion",
      ssh_user: "me",
      ssh_auth_mode: "key",
    };
    expect(fields(validateForm({ kind: "postgres", values }, false))).toEqual([
      "ssh_key_file",
    ]);
    expect(validateForm({ kind: "postgres", values }, true)).toEqual([]);
  });

  it("refuses SRV with a tunnel on the SSH tab", () => {
    const values = {
      ...MONGO_DEFAULTS,
      database: "app",
      srv: true,
      ssh_host: "bastion",
    };
    const errs = validateForm({ kind: "mongodb", values });
    expect(errs.map((e) => [e.tab, e.field])).toEqual([["ssh", "ssh_host"]]);
  });

  it("checks advanced numbers and pool order", () => {
    const bad = validateForm({
      kind: "postgres",
      values: { ...PG_DEFAULTS, pool_max: "-1", idle_timeout_secs: "1.5" },
    });
    expect(fields(bad)).toEqual(["pool_max", "idle_timeout_secs"]);
    const order = validateForm({
      kind: "postgres",
      values: { ...PG_DEFAULTS, pool_max: "2", pool_min: "5" },
    });
    expect(fields(order)).toEqual(["pool_min"]);
    expect(firstErrorTab("postgres", order)).toBe("advanced");
  });

  it("needs a SQLite file", () => {
    expect(
      fields(validateForm({ kind: "sqlite", values: SQLITE_DEFAULTS })),
    ).toEqual(["path"]);
  });
});

describe("tabChanged", () => {
  it("is quiet on defaults, including fresh DocumentDB", () => {
    for (const tab of ["safety", "ssl", "ssh", "advanced"] as const) {
      expect(tabChanged({ kind: "postgres", values: PG_DEFAULTS }, tab)).toBe(
        false,
      );
      expect(
        tabChanged({ kind: "documentdb", values: DOCUMENTDB_DEFAULTS }, tab),
      ).toBe(false);
    }
  });

  it("flags the tab holding a changed field", () => {
    const pg = { ...PG_DEFAULTS, read_only: true, ssh_host: "b" };
    expect(tabChanged({ kind: "postgres", values: pg }, "safety")).toBe(true);
    expect(tabChanged({ kind: "postgres", values: pg }, "ssh")).toBe(true);
    expect(tabChanged({ kind: "postgres", values: pg }, "ssl")).toBe(false);
    const mongo = { ...MONGO_DEFAULTS, replica_set: "rs1" };
    expect(tabChanged({ kind: "mongodb", values: mongo }, "advanced")).toBe(
      true,
    );
    const sqlite = {
      ...SQLITE_DEFAULTS,
      guard: { ...SQLITE_DEFAULTS.guard, read_only: true },
    };
    expect(tabChanged({ kind: "sqlite", values: sqlite }, "safety")).toBe(true);
  });

  // covers: AC-10
  it("never marks the Connection tab", () => {
    const pg = { ...PG_DEFAULTS, host: "elsewhere", port: "1" };
    expect(tabChanged({ kind: "postgres", values: pg }, "connection")).toBe(
      false,
    );
  });

  // covers: AC-10, AC-11
  it("compares DocumentDB with its own defaults, replica set on Connection", () => {
    const docdb = { ...DOCUMENTDB_DEFAULTS, replica_set: "rs9" };
    expect(tabChanged({ kind: "documentdb", values: docdb }, "advanced")).toBe(
      false,
    );
    const plainMongo = { ...DOCUMENTDB_DEFAULTS, tls: false };
    expect(tabChanged({ kind: "documentdb", values: plainMongo }, "ssl")).toBe(
      true,
    );
    expect(
      tabChanged({ kind: "mongodb", values: DOCUMENTDB_DEFAULTS }, "ssl"),
    ).toBe(true);
  });

  // covers: AC-10
  it("marks Advanced when retryable writes are disabled on MongoDB", () => {
    const mongo = { ...MONGO_DEFAULTS, retry_writes: true };
    expect(tabChanged({ kind: "mongodb", values: mongo }, "advanced")).toBe(
      true,
    );
  });
});

describe("tabsFor", () => {
  // covers: AC-4
  it("gives server kinds five tabs and SQLite two", () => {
    const labels = (k: Parameters<typeof tabsFor>[0]) =>
      tabsFor(k).map((t) => t.label);
    for (const kind of ["postgres", "mongodb", "documentdb"] as const) {
      expect(labels(kind)).toEqual([
        "Connection",
        "Safety",
        "TLS/SSL",
        "SSH Tunnel",
        "Advanced",
      ]);
    }
    expect(labels("sqlite")).toEqual(["Connection", "Safety"]);
  });
});
