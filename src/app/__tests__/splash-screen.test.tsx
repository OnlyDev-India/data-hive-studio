import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SplashScreen } from "../splash-screen";

afterEach(cleanup);

describe("SplashScreen", () => {
  it("shows the brand mark and Loading as a polite status", () => {
    render(<SplashScreen />);
    expect(screen.getByTestId("brand-mark")).toHaveAttribute("aria-hidden");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
  });

  it("shows the bootstrap status when one is set", () => {
    render(<SplashScreen status="Opening database…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening database…");
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("pulses the three bands as essential motion, top to bottom", () => {
    render(<SplashScreen />);
    const bands = [...document.querySelectorAll("[data-band]")];
    expect(bands).toHaveLength(3);
    for (const band of bands) {
      expect(band).toHaveClass("animate-mark-pulse", "fill-foreground");
      expect(band).toHaveAttribute("data-essential-motion");
    }
    expect(bands.map((b) => (b as SVGElement).style.animationDelay)).toEqual([
      "0s",
      "0.2s",
      "0.4s",
    ]);
    expect(document.querySelector("[data-lens]")).not.toHaveClass(
      "animate-mark-pulse",
    );
  });

  it("has no inline style block or literal colors", () => {
    const { container } = render(<SplashScreen />);
    expect(container.querySelector("style")).toBeNull();
    expect(container.innerHTML).not.toMatch(
      /#[0-9a-f]{3,8}\b|rgba?\(|radial-gradient/i,
    );
  });
});
