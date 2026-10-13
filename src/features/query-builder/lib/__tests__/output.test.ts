import { describe, expect, it } from "vitest";
import type { BuilderQuery } from "@/shared/store";
import { scriptText, sendSet } from "../output";

const q = (id: string): BuilderQuery => ({
  id,
  kind: "select",
  name: null,
  clauses: [],
});

describe("sendSet", () => {
  const all = [q("a"), q("b"), q("c")];

  it("sends every query unless two or more are picked", () => {
    expect(sendSet(all, ["b"]).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("sends the picked queries in canvas order", () => {
    expect(sendSet(all, ["c", "a"]).map((x) => x.id)).toEqual(["a", "c"]);
  });
});

describe("scriptText", () => {
  it("ends each statement with ; and names it above, a blank line between", () => {
    expect(
      scriptText([
        { name: "Big orders", text: "SELECT *\nFROM orders" },
        { name: null, text: "DROP TABLE t;" },
      ]),
    ).toBe("-- name: Big orders\nSELECT *\nFROM orders;\n\nDROP TABLE t;");
  });

  it("puts the ; on its own line after a trailing line comment", () => {
    expect(scriptText([{ name: null, text: "SELECT 1 -- one" }])).toBe(
      "SELECT 1 -- one\n;",
    );
  });
});
