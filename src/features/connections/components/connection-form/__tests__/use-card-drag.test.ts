import { describe, expect, it } from "vitest";
import { clampOffset } from "../use-card-drag";

const area = { width: 1000, height: 800 };
const card = { width: 600, height: 400 };

describe("clampOffset", () => {
  it("keeps the card inside the area, minus the margin", () => {
    expect(clampOffset({ x: 900, y: -900 }, area, card, 16)).toEqual({
      x: 184,
      y: -184,
    });
  });

  it("leaves an offset inside the range alone", () => {
    expect(clampOffset({ x: 50, y: 20 }, area, card, 16)).toEqual({
      x: 50,
      y: 20,
    });
  });

  it("pulls the card back to centre when the area shrinks to its size", () => {
    expect(
      clampOffset({ x: 120, y: 80 }, { width: 600, height: 400 }, card, 16),
    ).toEqual({ x: 0, y: 0 });
  });
});
