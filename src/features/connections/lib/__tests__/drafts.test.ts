import { beforeEach, describe, expect, it } from "vitest";
import { isFreshCard, useConnectionDrafts } from "../drafts";
import { uniqueCopyName } from "../connect-saved";

const drafts = () => useConnectionDrafts.getState();

beforeEach(() => drafts().reset());

describe("useConnectionDrafts", () => {
  it("starts fresh on PostgreSQL step one", () => {
    expect(drafts()).toMatchObject({ step: "pick", kind: "postgres" });
    expect(isFreshCard(drafts())).toBe(true);
  });

  it("keeps each kind's draft across Previous", () => {
    drafts().openForm();
    drafts().patchPg({ host: "pg.example" });
    drafts().backToPicker();
    drafts().pickKind("mongodb");
    drafts().openForm();
    drafts().patchMongo({ database: "app" });
    drafts().backToPicker();
    drafts().pickKind("postgres");
    expect(drafts().pg.host).toBe("pg.example");
    expect(drafts().mongo.database).toBe("app");
    expect(isFreshCard(drafts())).toBe(false);
  });

  it("applies DocumentDB defaults on the shared Mongo draft", () => {
    drafts().patchMongo({ port: "", replica_set: "mine" });
    drafts().pickKind("documentdb");
    expect(drafts().mongo).toMatchObject({
      port: "27017",
      srv: false,
      tls: true,
      retry_writes: true,
      replica_set: "mine",
    });
  });

  it("picking a card alone is still fresh", () => {
    drafts().pickKind("documentdb");
    expect(isFreshCard(drafts())).toBe(true);
  });

  it("loads a saved entry into step two and reset clears it", () => {
    const visit = drafts().visit;
    drafts().loadSaved(
      "postgres",
      {
        kind: "postgres",
        name: "Orders",
        host: "db",
        port: 5432,
        user: "app",
        password: "",
        database: "orders",
      },
      { oldName: "Orders", name: "Orders" },
    );
    expect(drafts()).toMatchObject({
      step: "form",
      kind: "postgres",
      edit: { oldName: "Orders" },
    });
    expect(drafts().pg.name).toBe("Orders");
    expect(drafts().visit).toBe(visit + 1);
    drafts().reset();
    expect(isFreshCard(drafts())).toBe(true);
  });

  it("carries the name and safety settings when editing changes the kind", () => {
    drafts().loadSaved(
      "postgres",
      {
        kind: "postgres",
        name: "Orders",
        host: "db",
        port: 5432,
        user: "app",
        password: "",
        database: "orders",
        read_only: true,
        env_label: "Production",
      },
      { oldName: "Orders", name: "Orders" },
    );
    drafts().backToPicker();
    drafts().pickKind("mongodb");
    expect(drafts().mongo).toMatchObject({
      name: "Orders",
      read_only: true,
      env_label: "Production",
    });
    drafts().pickKind("sqlite");
    expect(drafts().sqlite.name).toBe("Orders");
    expect(drafts().sqlite.guard.read_only).toBe(true);
  });

  it("leaves other drafts alone when not editing", () => {
    drafts().patchPg({ name: "pg only", read_only: true });
    drafts().pickKind("mongodb");
    expect(drafts().mongo).toMatchObject({ name: "", read_only: false });
  });
});

describe("uniqueCopyName", () => {
  it("numbers copies past the taken names", () => {
    expect(uniqueCopyName("A", {})).toBe("A copy");
    expect(uniqueCopyName("A", { "A copy": 1, "A copy 2": 1 })).toBe(
      "A copy 3",
    );
  });
});
