import { afterEach, describe, expect, it } from "vitest";
import { applyAccent, readAccent } from "../accent";
import { applyCornerStyle, readCornerStyle } from "../corners";
import { applyFont, listFonts, readFont } from "../font";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
});

describe("stored appearance values", () => {
  it.each(["inter", "georgia", "verdana", "junk", null])(
    "reads font %s as IBM Plex Sans",
    (stored) => {
      if (stored !== null) localStorage.setItem("font", stored);
      expect(readFont()).toBe("plex");
    },
  );

  it("keeps System UI", () => {
    localStorage.setItem("font", "system");
    expect(readFont()).toBe("system");
  });

  it("offers exactly Plex and System UI", () => {
    expect(listFonts().map((f) => f.id)).toEqual(["plex", "system"]);
  });

  it("defaults the accent to DH Blue and keeps a chosen Graphite", () => {
    expect(readAccent()).toBe("blue");
    localStorage.setItem("accent", "graphite");
    expect(readAccent()).toBe("graphite");
    localStorage.setItem("accent", "chartreuse");
    expect(readAccent()).toBe("blue");
  });

  it.each(["sharp", "soft", "round"])("keeps corner style %s", (id) => {
    localStorage.setItem("cornerStyle", id);
    expect(readCornerStyle()).toBe(id);
  });

  it("reads junk corners as Round", () => {
    localStorage.setItem("cornerStyle", "blobby");
    expect(readCornerStyle()).toBe("round");
  });
});

describe("applying appearance", () => {
  it("moves inline overrides from older builds onto data attributes", () => {
    const root = document.documentElement;
    root.style.setProperty("--primary", "oklch(0.55 0.2 250)");
    root.style.setProperty("--font-sans-active", "Georgia");
    root.style.setProperty("--radius-lg-active", "0px");

    applyAccent("purple");
    applyFont("system");
    applyCornerStyle("soft");

    expect(root.getAttribute("style") ?? "").toBe("");
    expect(root.dataset.accent).toBe("purple");
    expect(root.dataset.font).toBe("system");
    expect(root.dataset.corners).toBe("soft");
  });
});
