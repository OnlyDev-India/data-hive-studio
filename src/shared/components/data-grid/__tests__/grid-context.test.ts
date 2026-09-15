import { describe, it, expect } from "vitest";
import {
  computeFillBox,
  isNewFillCell,
  fillSourceCell,
  type SelBounds,
} from "../grid-context";

describe("computeFillBox", () => {
  const source: SelBounds = { min_r: 2, max_r: 4, min_ci: 1, max_ci: 3 };

  it("extends down when the target is below the net", () => {
    expect(computeFillBox(source, { row: 7, ci: 2 })).toEqual({
      min_r: 2,
      max_r: 7,
      min_ci: 1,
      max_ci: 3,
    });
  });

  it("extends up when the target is above the net", () => {
    expect(computeFillBox(source, { row: 0, ci: 2 })).toEqual({
      min_r: 0,
      max_r: 4,
      min_ci: 1,
      max_ci: 3,
    });
  });

  it("extends right when the target is right of the net", () => {
    expect(computeFillBox(source, { row: 3, ci: 6 })).toEqual({
      min_r: 2,
      max_r: 4,
      min_ci: 1,
      max_ci: 6,
    });
  });

  it("extends left when the target is left of the net", () => {
    expect(computeFillBox(source, { row: 3, ci: 0 })).toEqual({
      min_r: 2,
      max_r: 4,
      min_ci: 0,
      max_ci: 3,
    });
  });

  it("extends both axes at once for a diagonal drag", () => {
    expect(computeFillBox(source, { row: 6, ci: 5 })).toEqual({
      min_r: 2,
      max_r: 6,
      min_ci: 1,
      max_ci: 5,
    });
  });

  it("is a no-op when the target is inside (or on the edge of) the net", () => {
    expect(computeFillBox(source, { row: 3, ci: 2 })).toBeNull();
    expect(computeFillBox(source, { row: 4, ci: 3 })).toBeNull();
  });
});

describe("isNewFillCell / fillSourceCell", () => {
  const source: SelBounds = { min_r: 2, max_r: 4, min_ci: 1, max_ci: 3 };

  it("cells inside the net are not new", () => {
    expect(isNewFillCell(source, 3, 2)).toBe(false);
  });

  it("a straight-down new cell clamps to the net's bottom row", () => {
    expect(isNewFillCell(source, 6, 2)).toBe(true);
    expect(fillSourceCell(source, 6, 2)).toEqual({ row: 4, ci: 2 });
  });

  it("a straight-right new cell clamps to the net's right column", () => {
    expect(isNewFillCell(source, 3, 5)).toBe(true);
    expect(fillSourceCell(source, 3, 5)).toEqual({ row: 3, ci: 3 });
  });

  it("a diagonal new cell clamps to the net's corner", () => {
    expect(isNewFillCell(source, 6, 5)).toBe(true);
    expect(fillSourceCell(source, 6, 5)).toEqual({ row: 4, ci: 3 });
  });
});
