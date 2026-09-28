import { beforeEach, describe, expect, it } from "vitest";
import {
  WEB_CONNECTIONS_KEY,
  readWebConnections,
  scrubLegacyWebStorage,
  withoutSecrets,
  writeWebConnections,
} from "../web-connections";
import type { SavedConnParams } from "../../store/types";

const pg: SavedConnParams = {
  name: "orders",
  kind: "postgres",
  host: "db.example.com",
  port: 5432,
  user: "app",
  password: "hunter2",
  database: "orders",
  ssl_mode: "require",
  read_only: true,
  env_label: "Production",
};

function stored(): Record<string, unknown>[] {
  return JSON.parse(localStorage.getItem(WEB_CONNECTIONS_KEY) ?? "[]");
}

beforeEach(() => localStorage.clear());

describe("saved connections in the browser (AC-4)", () => {
  it("writes the password only when the connection remembers its secret", () => {
    writeWebConnections({
      keep: { ...pg, name: "keep", remember_secret: true },
      ask: { ...pg, name: "ask", remember_secret: false },
      unset: { ...pg, name: "unset" },
    });
    const rows = Object.fromEntries(stored().map((r) => [r.name, r]));
    expect(rows.keep.password).toBe("hunter2");
    expect(rows.ask).not.toHaveProperty("password");
    expect(rows.unset).not.toHaveProperty("password");
    expect(rows.ask.remember_secret).toBe(false);
  });

  it("leaves the SSH password out the same way and keeps the SSH host", () => {
    const tunnel = {
      ...pg,
      ssh_host: "jump",
      ssh_port: 2222,
      ssh_user: "me",
      ssh_password: "sshpw",
    };
    writeWebConnections({
      a: { ...tunnel, name: "a", remember_secret: false },
    });
    expect(stored()[0]).toMatchObject({
      ssh: { host: "jump", port: 2222, user: "me" },
    });
    expect(stored()[0]).not.toHaveProperty("ssh_password");
    writeWebConnections({ a: { ...tunnel, name: "a", remember_secret: true } });
    expect(stored()[0].ssh_password).toBe("sshpw");
  });

  it("round trips a record and keeps its id across saves", () => {
    writeWebConnections({ orders: { ...pg, remember_secret: true } });
    const id = stored()[0].id;
    expect(typeof id).toBe("string");
    writeWebConnections({
      orders: { ...pg, host: "other", remember_secret: true },
    });
    expect(stored()[0].id).toBe(id);
    expect(readWebConnections().orders).toMatchObject({
      kind: "postgres",
      host: "other",
      password: "hunter2",
      remember_secret: true,
      read_only: true,
      env_label: "Production",
    });
  });

  it("gives a connection saved without its secret an empty password", () => {
    writeWebConnections({ orders: { ...pg, remember_secret: false } });
    expect(readWebConnections().orders.password).toBe("");
  });

  it("saves DocumentDB as MongoDB with retry writes off", () => {
    writeWebConnections({
      docs: { ...pg, name: "docs", kind: "documentdb", replica_set: "rs0" },
    });
    expect(stored()[0]).toMatchObject({
      kind: "mongodb",
      retry_writes: true,
      replica_set: "rs0",
    });
  });

  it("never saves a SQLite file", () => {
    writeWebConnections({ file: { ...pg, name: "file", kind: "sqlite" } });
    expect(stored()).toEqual([]);
  });

  it("reads nothing from damaged storage", () => {
    localStorage.setItem(WEB_CONNECTIONS_KEY, "{not json");
    expect(readWebConnections()).toEqual({});
  });

  it("deletes what older builds left behind, and strips secrets from a recent copy", () => {
    localStorage.setItem("saved.local", "{}");
    localStorage.setItem("dh.web.servers", "{}");
    scrubLegacyWebStorage();
    expect(localStorage.getItem("saved.local")).toBeNull();
    expect(localStorage.getItem("dh.web.servers")).toBeNull();
    const recent = withoutSecrets({ ...pg, ssh_password: "x" });
    expect(recent.password).toBe("");
    expect(recent).not.toHaveProperty("ssh_password");
  });
});
