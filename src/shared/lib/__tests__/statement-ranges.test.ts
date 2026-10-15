import { describe, expect, it } from "vitest";
import { statementRanges } from "../utils";

const texts = (sql: string, dialect?: "mysql") =>
  statementRanges(sql, dialect)
    .map((r) => sql.slice(r.start, r.end).trim())
    .filter(Boolean);

describe("statementRanges, MySQL (spec 0025 AC-10)", () => {
  it("splits on semicolons outside quotes, backticks and comments", () => {
    expect(texts("SELECT 'a;b', `c;d`, \"e;f\"; SELECT 2", "mysql")).toEqual([
      "SELECT 'a;b', `c;d`, \"e;f\"",
      "SELECT 2",
    ]);
  });

  it("honours backslash escapes inside strings", () => {
    expect(texts("SELECT 'it\\'s; ok'; SELECT 2", "mysql")).toEqual([
      "SELECT 'it\\'s; ok'",
      "SELECT 2",
    ]);
  });

  it("treats # and '-- ' as comments, but not '--' without a space", () => {
    expect(texts("SELECT 1 # x; y\n; SELECT 2", "mysql")).toEqual([
      "SELECT 1 # x; y",
      "SELECT 2",
    ]);
    expect(texts("SELECT 1 -- x; y\n; SELECT 2", "mysql")).toEqual([
      "SELECT 1 -- x; y",
      "SELECT 2",
    ]);
    expect(texts("SELECT 5--1; SELECT 2", "mysql")).toEqual([
      "SELECT 5--1",
      "SELECT 2",
    ]);
  });

  it("keeps versioned comments inside their statement", () => {
    expect(texts("/*!40101 SET NAMES utf8mb4 */; SELECT 1", "mysql")).toEqual([
      "/*!40101 SET NAMES utf8mb4 */",
      "SELECT 1",
    ]);
  });

  it("runs a mysqldump DELIMITER ;; block as written", () => {
    const script = [
      "DROP PROCEDURE IF EXISTS p;",
      "DELIMITER ;;",
      "CREATE PROCEDURE p()",
      "BEGIN",
      "  SELECT 1;",
      "  SELECT 2;",
      "END ;;",
      "DELIMITER ;",
      "CALL p();",
    ].join("\n");
    const out = texts(script, "mysql");
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("DROP PROCEDURE IF EXISTS p");
    expect(out[1].startsWith("CREATE PROCEDURE p()")).toBe(true);
    expect(out[1].endsWith("END")).toBe(true);
    expect(out[1]).toContain("SELECT 1;");
    expect(out[2]).toBe("CALL p()");
    expect(out.some((t) => /delimiter/i.test(t))).toBe(false);
  });

  it("leaves the default splitter unchanged", () => {
    expect(texts("SELECT 1 # x; SELECT 2")).toEqual([
      "SELECT 1 # x",
      "SELECT 2",
    ]);
  });
});
