import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "./css-tokens";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "__tests__" ? [] : sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

const files = sourceFiles(resolve(ROOT, "src")).map((path) => ({
  path,
  text: readFileSync(path, "utf8"),
}));

describe("type scale floor", () => {
  it("has no text-3xs left", () => {
    const hits = files.filter((f) => /\btext-3xs\b/.test(f.text));
    expect(hits.map((f) => f.path)).toEqual([]);
  });

  it("has no arbitrary text size under 11px", () => {
    const small: string[] = [];
    for (const f of files) {
      for (const m of f.text.matchAll(/text-\[([\d.]+)(px|rem)\]/g)) {
        const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
        if (px < 11) small.push(`${f.path}: ${m[0]}`);
      }
    }
    expect(small).toEqual([]);
  });
});
