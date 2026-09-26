import { afterEach, describe, expect, it, vi } from "vitest";

async function loadKinds(web: boolean) {
  vi.resetModules();
  vi.doMock("@/shared/api/web", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/shared/api/web")>()),
    WEB: web,
  }));
  return import("../kinds");
}

afterEach(() => vi.doUnmock("@/shared/api/web"));

describe("KIND_ITEMS", () => {
  // covers: AC-1
  it("lists every kind on the desktop", async () => {
    const { KIND_ITEMS } = await loadKinds(false);
    expect(KIND_ITEMS.map((i) => i.label)).toEqual([
      "SQLite",
      "PostgreSQL",
      "MongoDB",
      "Amazon DocumentDB",
    ]);
  });

  // covers: AC-27
  it("drops SQLite on the web", async () => {
    const { KIND_ITEMS } = await loadKinds(true);
    expect(KIND_ITEMS.map((i) => i.id)).toEqual([
      "postgres",
      "mongodb",
      "documentdb",
    ]);
  });
});

describe("kindItem", () => {
  it("finds a kind by id, even SQLite on the web", async () => {
    const { kindItem } = await loadKinds(true);
    expect(kindItem("documentdb").label).toBe("Amazon DocumentDB");
    expect(kindItem("sqlite").label).toBe("SQLite");
  });
});
