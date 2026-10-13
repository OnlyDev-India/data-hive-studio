import { describe, expect, it } from "vitest";
import { parseBlocks, readProjectFile } from "./css-tokens";

const blocks = parseBlocks(
  readProjectFile("src/shared/theme/editor-theme.css"),
);
const names = (sel: string) =>
  Object.keys(blocks.get(sel) ?? {})
    .filter((n) => n.startsWith("--syntax-"))
    .sort();

describe("editor-theme.css", () => {
  it("defines syntax tokens", () => {
    expect(names(":root").length).toBeGreaterThan(0);
  });

  it("defines every syntax token in both light and dark", () => {
    expect(names(".dark")).toEqual(names(":root"));
  });

  it("keeps the One Dark surface (#282c34) in dark mode", () => {
    expect(blocks.get(".dark")?.["--editor-background"]).toBe(
      "oklch(0.2925 0.0157 264.3)",
    );
    expect(
      readProjectFile("src/shared/theme/codemirror-theme.ts"),
    ).not.toContain('backgroundColor: "var(--background)"');
  });
});
