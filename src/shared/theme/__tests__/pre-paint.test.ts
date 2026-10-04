import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBlocks, readProjectFile } from "./css-tokens";

const html = readProjectFile("index.html");
const blocks = parseBlocks(readProjectFile("src/index.css"));
const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

function runPrePaint(stored: Record<string, string>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
  new Function(script)();
  return document.documentElement;
}

function resetRoot() {
  const root = document.documentElement;
  root.className = "";
  root.removeAttribute("style");
  for (const a of ["data-accent", "data-font", "data-corners"])
    root.removeAttribute(a);
}

afterEach(() => {
  resetRoot();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("index.html pre paint", () => {
  it("paints the same backgrounds as index.css", () => {
    const light = /html,\s*body\s*\{\s*background:\s*([^;]+);/.exec(html)?.[1];
    const dark = /html\.dark body\s*\{\s*background:\s*([^;]+);/.exec(
      html,
    )?.[1];
    expect(light).toBe(blocks.get(":root")?.["--background"]);
    expect(dark).toBe(blocks.get(".dark")?.["--background"]);
  });

  it("applies every saved appearance setting", () => {
    const root = runPrePaint({
      darkmode: "true",
      accent: "teal",
      font: "system",
      cornerStyle: "sharp",
      uiScale: "125",
    });
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.dataset.accent).toBe("teal");
    expect(root.dataset.font).toBe("system");
    expect(root.dataset.corners).toBe("sharp");
    expect(root.style.fontSize).toBe("125%");
  });

  it("falls back to the defaults for junk values", () => {
    const root = runPrePaint({
      darkmode: "false",
      accent: "chartreuse",
      font: "georgia",
      cornerStyle: "blobby",
      uiScale: "abc",
    });
    expect(root.classList.contains("dark")).toBe(false);
    expect(root.dataset.accent).toBe("blue");
    expect(root.dataset.font).toBe("plex");
    expect(root.dataset.corners).toBe("round");
    expect(root.style.fontSize).toBe("");
  });

  it("clamps the scale like readScale", () => {
    expect(runPrePaint({ uiScale: "500" }).style.fontSize).toBe("200%");
  });

  it("keeps the defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const root = document.documentElement;
    expect(() => new Function(script)()).not.toThrow();
    expect(root.dataset.accent).toBe("blue");
    expect(root.dataset.font).toBe("plex");
    expect(root.dataset.corners).toBe("round");
  });
});
