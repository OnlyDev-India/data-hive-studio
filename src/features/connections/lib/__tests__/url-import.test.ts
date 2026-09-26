import { describe, expect, it } from "vitest";
import { parseConnectionUrl } from "../url-import";

describe("parseConnectionUrl", () => {
  it("fills a PostgreSQL form, keeping fields the URL lacks", () => {
    const r = parseConnectionUrl(
      "postgres",
      "postgresql://a%40b:p%23w@db.example/orders?sslmode=require",
    );
    expect(r).toEqual({
      ok: true,
      patch: {
        user: "a@b",
        password: "p#w",
        host: "db.example",
        database: "orders",
        ssl_mode: "require",
      },
    });
  });

  it("turns SRV and TLS on for mongodb+srv and leaves the port", () => {
    const r = parseConnectionUrl(
      "mongodb",
      "mongodb+srv://me:pw@cluster.example/app?retryWrites=false",
    );
    expect(r.ok && r.patch).toMatchObject({
      srv: true,
      tls: true,
      retry_writes: true,
      host: "cluster.example",
      database: "app",
    });
    expect(r.ok && r.patch).not.toHaveProperty("port");
  });

  it("reads port and replica set from a plain mongodb URL", () => {
    const r = parseConnectionUrl(
      "documentdb",
      "mongodb://me:pw@docdb:27018/app?replicaSet=rs0&tls=true",
    );
    expect(r.ok && r.patch).toMatchObject({
      port: "27018",
      replica_set: "rs0",
      tls: true,
      srv: false,
    });
  });

  it("points at the right card for another kind's URL", () => {
    expect(parseConnectionUrl("postgres", "mongodb://h/db")).toEqual({
      ok: false,
      message: "This is a MongoDB URL. Go back and pick MongoDB.",
    });
    expect(parseConnectionUrl("mongodb", "postgres://h/db")).toEqual({
      ok: false,
      message: "This is a PostgreSQL URL. Go back and pick PostgreSQL.",
    });
    expect(
      parseConnectionUrl("documentdb", "mongodb+srv://h/db"),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("pick MongoDB"),
    });
  });

  it("rejects text that is not a connection URL", () => {
    for (const raw of ["not a url", "https://example.com"]) {
      expect(parseConnectionUrl("postgres", raw)).toEqual({
        ok: false,
        message: "Could not parse that connection URL.",
      });
    }
  });
});
