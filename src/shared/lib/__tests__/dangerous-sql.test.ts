import { describe, expect, it } from "vitest";
import { dangerousSqlReason } from "../dangerous-sql";

describe("dangerousSqlReason", () => {
  it("flags DELETE with no WHERE", () => {
    expect(dangerousSqlReason("DELETE FROM users")).toMatch(/DELETE/);
  });

  it("flags UPDATE with no WHERE", () => {
    expect(dangerousSqlReason("update users set active = 1")).toMatch(/UPDATE/);
  });

  it("does not flag DELETE with a WHERE clause", () => {
    expect(dangerousSqlReason("DELETE FROM users WHERE id = 1")).toBeNull();
  });

  it("does not flag UPDATE with a WHERE clause", () => {
    expect(
      dangerousSqlReason("UPDATE users SET active = 1 WHERE id = 1"),
    ).toBeNull();
  });

  it("is not fooled by 'where' inside a string literal", () => {
    expect(
      dangerousSqlReason("DELETE FROM logs WHERE msg = 'no idea where'"),
    ).toBeNull();
    expect(
      dangerousSqlReason("DELETE FROM logs WHERE 1=1 -- where clause below"),
    ).toBeNull();
    expect(dangerousSqlReason("UPDATE t SET note = 'where?'")).toMatch(
      /UPDATE/,
    );
  });

  it("flags TRUNCATE and DROP unconditionally", () => {
    expect(dangerousSqlReason("TRUNCATE TABLE users")).toMatch(/TRUNCATE/);
    expect(dangerousSqlReason("DROP TABLE users")).toMatch(/DROP/);
  });

  it("does not flag SELECT", () => {
    expect(dangerousSqlReason("SELECT * FROM users")).toBeNull();
  });
});
