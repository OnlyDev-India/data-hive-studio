import { describe, expect, it } from "vitest";
import { compressSql } from "./compress-sql";

describe("compressSql", () => {
  it("collapses whitespace/newlines to single spaces", () => {
    expect(compressSql("SELECT\n  *\n  FROM   users\n  WHERE id = 1")).toBe(
      "SELECT * FROM users WHERE id = 1",
    );
  });

  it("leaves string literal content untouched", () => {
    expect(compressSql("SELECT 'a\n  b'   FROM t")).toBe(
      "SELECT 'a\n  b' FROM t",
    );
  });

  it("keeps a line comment's own text and terminating newline", () => {
    expect(compressSql("SELECT 1 -- keep   this\nFROM t")).toBe(
      "SELECT 1 -- keep   this\nFROM t",
    );
  });

  it("leaves block comment content untouched", () => {
    expect(compressSql("SELECT /* a\n  b */ 1")).toBe("SELECT /* a\n  b */ 1");
  });

  it("trims leading/trailing whitespace", () => {
    expect(compressSql("\n  SELECT 1\n\n")).toBe("SELECT 1");
  });
});
