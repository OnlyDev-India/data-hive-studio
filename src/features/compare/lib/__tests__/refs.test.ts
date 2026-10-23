import { describe, expect, it } from "vitest";
import { engine_of, ref_engine } from "../refs";

describe("engine_of", () => {
  it("compares MariaDB as MySQL, so a table compares across the two", () => {
    expect(engine_of("mariadb")).toBe("mysql");
    expect(engine_of("mysql")).toBe("mysql");
    expect(
      ref_engine({ conn_id: "c", conn_key: "mariadb:app@db", table: "t" }),
    ).toBe("mysql");
  });

  it("keeps the other engines as they are", () => {
    expect(engine_of("documentdb")).toBe("mongodb");
    expect(engine_of("postgres")).toBe("postgres");
    expect(engine_of("sqlite")).toBe("sqlite");
  });
});
