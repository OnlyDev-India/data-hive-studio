import { describe, expect, it } from "vitest";
import type { SavedConnParams } from "@/shared/store";
import { MONGO_DEFAULTS, PG_DEFAULTS } from "../defaults";
import {
  mongoFormFromSaved,
  pgFormFromSaved,
  sqliteFormFromSaved,
} from "../from-saved";

const base: SavedConnParams = {
  kind: "postgres",
  host: "db.example",
  port: 5433,
  user: "app",
  password: "pw",
  database: "orders",
};

describe("pgFormFromSaved", () => {
  // covers: AC-18
  it("fills defaults for everything an older saved entry lacks", () => {
    expect(pgFormFromSaved(base)).toEqual({
      ...PG_DEFAULTS,
      host: "db.example",
      port: "5433",
      user: "app",
      password: "pw",
      database: "orders",
    });
  });

  it("turns saved numbers into text, keeping a zero", () => {
    const form = pgFormFromSaved({
      ...base,
      name: "Orders",
      ssl_mode: "require",
      pool_max: 10,
      pool_min: 0,
      connect_timeout_secs: 5,
      ssh_host: "bastion",
      ssh_port: 2222,
      ssh_auth_mode: "key",
    });
    expect(form).toMatchObject({
      name: "Orders",
      ssl_mode: "require",
      pool_max: "10",
      pool_min: "0",
      connect_timeout_secs: "5",
      idle_timeout_secs: "",
      ssh_host: "bastion",
      ssh_port: "2222",
      ssh_auth_mode: "key",
    });
  });

  it("loads the safety settings", () => {
    expect(pgFormFromSaved({ ...base, read_only: true }).read_only).toBe(true);
  });
});

describe("mongoFormFromSaved", () => {
  const mongo: SavedConnParams = { ...base, kind: "mongodb", port: 27017 };

  it("defaults auth source to admin, even when saved blank", () => {
    expect(mongoFormFromSaved(mongo).auth_db).toBe("admin");
    expect(mongoFormFromSaved({ ...mongo, auth_db: "" }).auth_db).toBe("admin");
    expect(mongoFormFromSaved({ ...mongo, auth_db: "users" }).auth_db).toBe(
      "users",
    );
  });

  // covers: AC-9
  it("ticks Disable retryable writes only when saved as false", () => {
    expect(mongoFormFromSaved(mongo).retry_writes).toBe(false);
    expect(
      mongoFormFromSaved({ ...mongo, retry_writes: true }).retry_writes,
    ).toBe(false);
    expect(
      mongoFormFromSaved({ ...mongo, retry_writes: false }).retry_writes,
    ).toBe(true);
  });

  it("keeps SRV, TLS and the replica set", () => {
    expect(
      mongoFormFromSaved({
        ...mongo,
        srv: true,
        tls: true,
        replica_set: "rs0",
      }),
    ).toMatchObject({ srv: true, tls: true, replica_set: "rs0" });
    expect(mongoFormFromSaved(mongo)).toMatchObject({
      srv: MONGO_DEFAULTS.srv,
      tls: MONGO_DEFAULTS.tls,
      replica_set: "",
    });
  });
});

describe("sqliteFormFromSaved", () => {
  it("takes the file path, name and guard", () => {
    const form = sqliteFormFromSaved({
      ...base,
      kind: "sqlite",
      name: "local",
      source_path: "/tmp/local.db",
      read_only: true,
    });
    expect(form.path).toBe("/tmp/local.db");
    expect(form.name).toBe("local");
    expect(form.guard.read_only).toBe(true);
  });

  it("has no path when none was saved", () => {
    expect(sqliteFormFromSaved({ ...base, kind: "sqlite" }).path).toBeNull();
  });
});
