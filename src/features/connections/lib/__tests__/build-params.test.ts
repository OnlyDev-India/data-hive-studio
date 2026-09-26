import { describe, expect, it } from "vitest";
import {
  mongoConnectParams,
  mongoDisplayName,
  mongoSavedParams,
  optionalNumber,
  pgConnectParams,
  pgDisplayName,
  pgSavedParams,
  sqliteDisplayName,
  sqliteSavedParams,
} from "../build-params";
import { MONGO_DEFAULTS, PG_DEFAULTS, SQLITE_DEFAULTS } from "../defaults";
import { mongoFormFromSaved, pgFormFromSaved } from "../from-saved";

describe("optionalNumber", () => {
  it("keeps an explicit zero and drops blanks and junk", () => {
    expect(optionalNumber("0")).toBe(0);
    expect(optionalNumber(" 12 ")).toBe(12);
    expect(optionalNumber("")).toBeUndefined();
    expect(optionalNumber("abc")).toBeUndefined();
  });
});

describe("PostgreSQL payloads", () => {
  it("builds the default connect payload", () => {
    expect(pgConnectParams(PG_DEFAULTS)).toEqual({
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "",
      database: "postgres",
      ssl_mode: "prefer",
      ssl_ca_file: undefined,
      ssl_client_cert_file: undefined,
      ssl_client_key_file: undefined,
      pool_max: undefined,
      pool_min: undefined,
      connect_timeout_secs: undefined,
      idle_timeout_secs: undefined,
      max_lifetime_secs: undefined,
      read_only: false,
      ssh: undefined,
    });
  });

  it("carries a tunnel, guard and pool settings", () => {
    const form = {
      ...PG_DEFAULTS,
      host: " db.example ",
      port: "6543",
      user: " app ",
      password: "pw",
      database: " orders ",
      pool_max: "0",
      read_only: true,
      env_label: "Production",
      ssh_host: "bastion",
      ssh_user: "me",
      ssh_password: "sshpw",
    };
    expect(pgConnectParams(form)).toMatchObject({
      host: "db.example",
      port: 6543,
      user: "app",
      database: "orders",
      pool_max: 0,
      read_only: true,
      env_label: "Production",
      ssh: {
        host: "bastion",
        port: 22,
        user: "me",
        auth_mode: "password",
        password: "sshpw",
      },
    });
  });

  it("saves flat ssh fields instead of the nested tunnel", () => {
    const saved = pgSavedParams({
      ...PG_DEFAULTS,
      ssh_host: "bastion",
      ssh_user: "me",
      remember_secret: true,
    });
    expect(saved).not.toHaveProperty("ssh");
    expect(saved).toMatchObject({
      kind: "postgres",
      ssh_host: "bastion",
      ssh_port: 22,
      ssh_user: "me",
      ssh_auth_mode: "password",
      remember_secret: true,
    });
  });

  it("round trips through a saved record", () => {
    const form = {
      ...PG_DEFAULTS,
      name: "Orders",
      host: "db",
      database: "orders",
      ssl_mode: "require",
      pool_min: "2",
    };
    const stored = { ...pgSavedParams(form), name: "Orders" };
    expect(pgFormFromSaved(stored)).toEqual({
      ...form,
      ssh_port: "",
    });
  });

  it("names a connection from name, then database, then user@host", () => {
    expect(pgDisplayName({ ...PG_DEFAULTS, name: " N " })).toBe("N");
    expect(pgDisplayName({ ...PG_DEFAULTS, database: "db" })).toBe("db");
    expect(pgDisplayName(PG_DEFAULTS)).toBe("postgres@localhost");
  });
});

describe("MongoDB payloads", () => {
  it("builds the default connect payload", () => {
    expect(mongoConnectParams(MONGO_DEFAULTS)).toEqual({
      host: "localhost",
      port: 27017,
      user: "",
      password: "",
      database: "",
      auth_db: "admin",
      srv: false,
      tls: false,
      ssl_ca_file: undefined,
      ssl_client_cert_file: undefined,
      retry_writes: undefined,
      read_only: false,
      replica_set: undefined,
      pool_max: undefined,
      pool_min: undefined,
      connect_timeout_secs: undefined,
      idle_timeout_secs: undefined,
      server_selection_timeout_secs: undefined,
      ssh: undefined,
    });
  });

  it("sends retry_writes false when disabled, and no tunnel with SRV", () => {
    const params = mongoConnectParams({
      ...MONGO_DEFAULTS,
      retry_writes: true,
      srv: true,
      ssh_host: "bastion",
    });
    expect(params.retry_writes).toBe(false);
    expect(params.ssh).toBeUndefined();
  });

  it("saves the DocumentDB kind and reloads retry writes disabled", () => {
    const form = {
      ...MONGO_DEFAULTS,
      database: "app",
      tls: true,
      retry_writes: true,
      replica_set: "rs0",
    };
    const saved = mongoSavedParams(form, "documentdb");
    expect(saved.kind).toBe("documentdb");
    expect(mongoSavedParams(form, "mongodb").kind).toBe("mongodb");
    expect(mongoFormFromSaved(saved)).toMatchObject({
      retry_writes: true,
      replica_set: "rs0",
      tls: true,
    });
  });

  it("names a connection like PostgreSQL does", () => {
    expect(mongoDisplayName({ ...MONGO_DEFAULTS, user: "me" })).toBe(
      "me@localhost",
    );
  });
});

describe("SQLite payloads", () => {
  it("saves the file path with blank network fields", () => {
    expect(
      sqliteSavedParams({ ...SQLITE_DEFAULTS, path: "/tmp/app.db" }),
    ).toEqual({
      kind: "sqlite",
      host: "",
      port: 0,
      user: "",
      password: "",
      database: "",
      source_path: "/tmp/app.db",
      read_only: false,
    });
  });

  it("defaults the name to the file name", () => {
    expect(
      sqliteDisplayName({ ...SQLITE_DEFAULTS, path: "C:\\data\\app.db" }),
    ).toBe("app.db");
  });
});
