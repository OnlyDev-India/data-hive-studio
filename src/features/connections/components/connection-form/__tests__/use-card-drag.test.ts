import { describe, expect, it } from "vitest";
import { clampOffset } from "../use-card-drag";

const area = { width: 1000, height: 800 };
const card = { left: 200, top: 200, width: 600, height: 400 };

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

  it("pulls the card back to rest when the area shrinks to its size", () => {
    expect(
      clampOffset(
        { x: 120, y: 80 },
        { width: 600, height: 400 },
        { ...card, left: 0, top: 0 },
        16,
      ),
    ).toEqual({ x: 0, y: 0 });
  });

  it("uses the card's real resting spot when something sits above it", () => {
    const below = { ...card, top: 248 };
    expect(clampOffset({ x: 0, y: 900 }, area, below, 16)).toEqual({
      x: 0,
      y: 136,
    });
    expect(clampOffset({ x: 0, y: -900 }, area, below, 16)).toEqual({
      x: 0,
      y: -232,
    });
  });
});
