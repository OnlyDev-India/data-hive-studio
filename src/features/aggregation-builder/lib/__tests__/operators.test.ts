import { describe, expect, it } from "vitest";
import { isWriteOp, OPERATORS, operatorOf } from "../operators";

describe("operators", () => {
  it("finds an operator by name with its starting body", () => {
    expect(operatorOf("$limit")).toMatchObject({
      op: "$limit",
      template: "10",
    });
    expect(operatorOf("$nope")).toBeUndefined();
  });

  it("lists each operator once, with a description", () => {
    const ops = OPERATORS.map((o) => o.op);
    expect(new Set(ops).size).toBe(ops.length);
    for (const o of OPERATORS) {
      expect(o.op).toMatch(/^\$[a-zA-Z]+$/);
      expect(o.description).not.toBe("");
    }
  });

  it("offers every operator that has a form", () => {
    for (const op of [
      "$match",
      "$project",
      "$sort",
      "$limit",
      "$skip",
      "$group",
      "$lookup",
      "$unwind",
    ])
      expect(operatorOf(op)).toBeDefined();
  });

  it("treats only $out and $merge as writes", () => {
    expect(OPERATORS.filter((o) => isWriteOp(o.op)).map((o) => o.op)).toEqual([
      "$out",
      "$merge",
    ]);
  });
});
