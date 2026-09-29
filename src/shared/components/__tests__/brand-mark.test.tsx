import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readProjectFile } from "@/shared/theme/__tests__/css-tokens";
import { BrandMark } from "../brand-mark";

afterEach(cleanup);

const LITERAL_COLOR = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\b(?:rgba?|hsla?)\(/,
  /\b(?:bg|text|border|fill|stroke|ring)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/,
  /<style/,
];
const DECORATION = [
  /\b(?:bg|text|border|fill|stroke|ring)-\[/,
  /radial-gradient/,
];

// The landing keeps its dot grid and glow, drawn from theme tokens.
describe("first screens use theme tokens only", () => {
  it.each([
    ["src/app/splash-screen.tsx", [...LITERAL_COLOR, ...DECORATION]],
    ["src/shared/components/brand-mark.tsx", [...LITERAL_COLOR, ...DECORATION]],
    ["src/features/connections/components/landing.tsx", LITERAL_COLOR],
  ])("%s has no literal colors", (path, patterns) => {
    const source = readProjectFile(path);
    for (const pattern of patterns) expect(source).not.toMatch(pattern);
  });
});

describe("BrandMark", () => {
  const parts = () => ({
    bands: [...document.querySelectorAll("[data-band]")],
    lens: document.querySelector("[data-lens]")!,
  });

  it("draws bands in foreground and the magnifier in primary", () => {
    render(<BrandMark motion="none" />);
    const { bands, lens } = parts();
    expect(bands).toHaveLength(3);
    for (const band of bands) expect(band).toHaveClass("fill-foreground");
    expect(lens).toHaveClass("stroke-primary");
  });

  it("cuts the gap with a mask, never a painted color", () => {
    render(<BrandMark motion="none" />);
    const mask = document.querySelector("mask")!;
    const group = document.querySelector("g[mask]")!;
    expect(group.getAttribute("mask")).toBe(`url(#${mask.id})`);
    expect(group.querySelectorAll("[data-band]")).toHaveLength(3);
    expect(document.querySelector(".fill-background")).toBeNull();
  });

  it("gives each mark its own mask id", () => {
    render(
      <>
        <BrandMark motion="none" />
        <BrandMark motion="none" />
      </>,
    );
    const [a, b] = document.querySelectorAll("mask");
    expect(a.id).not.toBe(b.id);
  });

  it("staggers the entrance and drops it under reduced motion", () => {
    render(<BrandMark motion="enter" />);
    const { bands, lens } = parts();
    for (const el of [...bands, lens])
      expect(el).toHaveClass(
        "animate-mark-enter",
        "motion-reduce:animate-none",
      );
    expect(
      [...bands, lens].map((el) => (el as SVGElement).style.animationDelay),
    ).toEqual(["0ms", "60ms", "120ms", "180ms"]);
    for (const band of bands)
      expect(band).not.toHaveAttribute("data-essential-motion");
  });

  it("does not animate at rest", () => {
    const { container } = render(<BrandMark motion="none" />);
    expect(container.innerHTML).not.toMatch(/animate-/);
  });
});
