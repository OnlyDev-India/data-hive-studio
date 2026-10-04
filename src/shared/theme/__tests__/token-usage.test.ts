import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readProjectFile, ROOT } from "./css-tokens";

const ALLOW = {
  hexAndPalette: [
    "src/app/splash-screen.tsx",
    "src/shared/components/icons/documentDb.tsx",
    "src/shared/components/icons/mongo.tsx",
    "src/shared/components/icons/mysql.tsx",
    "src/shared/components/icons/pg.tsx",
    "src/shared/components/icons/sqlite.tsx",
  ],
  labels: ["src/shared/components/query-editor/editor-context-menu.tsx"],
};

const PALETTE =
  /\b(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow|accent|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(?:-\d{2,3})?(?:\/\d+)?\b/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const LABELS = /\b(?:uppercase|normal-case|tracking-wider?)\b/g;
const LEGACY =
  /\b(?:[a-z-]+:)*(?:text-(?:2xs|xs|sm|base|lg|xl)|rounded(?:-[trblse]{1,2})?-(?:sm|md|lg|xl))\b/g;

type Rule = { pattern: RegExp; tsxOnly?: boolean; allow: string[] };

const RULES: Record<string, Rule> = {
  palette: { pattern: PALETTE, allow: ALLOW.hexAndPalette },
  hex: { pattern: HEX, allow: ALLOW.hexAndPalette },
  label: { pattern: LABELS, tsxOnly: true, allow: ALLOW.labels },
  legacy: { pattern: LEGACY, allow: [] },
};

const SOURCES = (
  readdirSync(resolve(ROOT, "src"), { recursive: true }) as string[]
)
  .map((p) => `src/${p.split("\\").join("/")}`)
  .filter(
    (p) =>
      /\.tsx?$/.test(p) && !p.includes("__tests__/") && !/\.test\./.test(p),
  );

const isComment = (line: string) => /^(?:\/\/|\/\*|\*)/.test(line.trim());

export function findMatches(
  pattern: RegExp,
  files: { path: string; text: string }[],
): string[] {
  const hits: string[] = [];
  for (const { path, text } of files)
    text.split("\n").forEach((line, i) => {
      if (isComment(line)) return;
      for (const m of line.matchAll(pattern))
        hits.push(`${path}:${i + 1}: ${m[0]}`);
    });
  return hits;
}

describe("token usage", () => {
  it.each(Object.entries(RULES))("has no %s matches", (_, rule) => {
    const files = SOURCES.filter(
      (p) => !rule.allow.includes(p) && (!rule.tsxOnly || p.endsWith(".tsx")),
    ).map((path) => ({ path, text: readProjectFile(path) }));
    expect(findMatches(rule.pattern, files).join("\n")).toBe("");
  });

  it.each([
    ["palette", 'className="text-sky-500"'],
    ["palette", 'cn("hover:bg-white/10")'],
    ["hex", 'const c = "#fff";'],
    ["label", '<span className="uppercase">'],
    ["legacy", 'className="text-xs"'],
    ["legacy", 'cn("hover:rounded-t-md")'],
  ])("catches a planted %s match", (name, line) => {
    const hits = findMatches(RULES[name].pattern, [
      { path: "fixture.tsx", text: line },
    ]);
    expect(hits).toHaveLength(1);
  });

  it("ignores comment lines", () => {
    const text = "// text-red-500\n * #abc\n/* bg-white */";
    expect(findMatches(PALETTE, [{ path: "f.ts", text }])).toEqual([]);
    expect(findMatches(HEX, [{ path: "f.ts", text }])).toEqual([]);
  });
});
