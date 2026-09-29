import { describe, expect, it } from "vitest";
import { listAccents } from "../accent";
import {
  contrast,
  parseBlocks,
  parseOklch,
  readProjectFile,
  resolveVar,
  themeVars,
} from "./css-tokens";

const blocks = parseBlocks(readProjectFile("src/index.css"));
const ACCENT_VARS = [
  "--primary",
  "--primary-foreground",
  "--primary-light",
  "--primary-dark",
  "--selection",
];
const TYPE_TOKENS = [
  "number",
  "text",
  "bool",
  "datetime",
  "json",
  "id",
  "enum",
  "binary",
].map((t) => `--type-${t}`);
const STATUSES = ["info", "success", "warning", "destructive"];
const DIFFS = ["add", "remove", "change"].map((d) => `--diff-${d}`);
const OBJECTS = [
  "relation",
  "routine",
  "type",
  "container",
  "security",
  "extension",
  "key",
].map((o) => `--obj-${o}`);
const NEUTRALS = [
  "background",
  "content",
  "foreground",
  "card",
  "popover",
  "secondary",
  "muted",
  "muted-foreground",
  "accent",
  "border",
  "input",
  "chrome",
  "chrome-muted",
  "editor-toolbar",
  "sidebar-header",
  "gutter",
  "scrollbar-thumb",
].map((t) => `--${t}`);
const MAX_NEUTRAL_CHROMA = 0.006;

const chromaOf = (value: string) =>
  Number(/oklch\(\s*[\d.]+\s+([\d.]+)/.exec(value)?.[1]);

const themes = [
  { name: "light", dark: false },
  { name: "dark", dark: true },
];

describe.each(themes)("$name theme", ({ dark }) => {
  const base = themeVars(blocks, dark, "blue");
  const pair = (fg: string, bg: string, vars = base) =>
    contrast(resolveVar(vars, fg), resolveVar(vars, bg));

  it("tints every neutral surface token", () => {
    const neutral = Object.keys(base).filter((k) =>
      /^--(background|foreground|border|chrome)/.test(k),
    );
    expect(neutral.length).toBeGreaterThan(4);
    for (const name of neutral)
      expect(chromaOf(base[name]), name).toBeGreaterThan(0);
  });

  it("keeps every neutral token near neutral", () => {
    for (const name of NEUTRALS)
      expect(chromaOf(resolveVar(base, name)), name).toBeLessThanOrEqual(
        MAX_NEUTRAL_CHROMA,
      );
  });

  it("keeps the overlay near neutral", () => {
    expect(chromaOf(resolveVar(base, "--overlay"))).toBeLessThanOrEqual(
      MAX_NEUTRAL_CHROMA,
    );
  });

  it("keeps the Graphite accent near neutral", () => {
    const vars = themeVars(blocks, dark, "graphite");
    for (const name of ACCENT_VARS)
      expect(chromaOf(resolveVar(vars, name)), name).toBeLessThanOrEqual(
        MAX_NEUTRAL_CHROMA,
      );
  });

  it.each([
    ["--foreground", "--background"],
    ["--foreground", "--card"],
    ["--foreground", "--popover"],
    ["--foreground", "--chrome"],
    ["--foreground", "--chrome-muted"],
    ["--muted-foreground", "--background"],
    ["--muted-foreground", "--muted"],
    ["--muted-foreground", "--chrome-muted"],
    ...STATUSES.map((s) => [`--${s}`, "--background"]),
    ...STATUSES.map((s) => [`--${s}-dark`, `--${s}-light`]),
    ...TYPE_TOKENS.map((t) => [t, "--background"]),
    ...DIFFS.map((d) => [`${d}-foreground`, d]),
    ...DIFFS.map((d) => [`${d}-foreground`, "--background"]),
    ["--destructive-foreground", "--destructive"],
  ])("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(pair(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ...OBJECTS.map((o) => [o, "--background"]),
    ...OBJECTS.map((o) => [o, "--chrome"]),
  ])("icon color %s on %s is at least 3:1", (fg, bg) => {
    expect(pair(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(listAccents().map((a) => a.id))(
    "accent %s keeps its text readable",
    (id) => {
      const vars = themeVars(blocks, dark, id);
      expect(
        pair("--primary-foreground", "--primary", vars),
      ).toBeGreaterThanOrEqual(4.5);
      expect(pair("--primary", "--background", vars)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        pair("--primary-dark", "--primary-light", vars),
      ).toBeGreaterThanOrEqual(4.5);
      expect(pair("--ring", "--background", vars)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe("accent blocks", () => {
  it("lists DH Blue first, then the other eight in order", () => {
    expect(listAccents().map((a) => a.id)).toEqual([
      "blue",
      "graphite",
      "purple",
      "pink",
      "red",
      "orange",
      "yellow",
      "green",
      "teal",
    ]);
  });

  it.each(
    listAccents()
      .map((a) => a.id)
      .filter((id) => id !== "blue"),
  )("%s sets all five variables in light and dark", (id) => {
    for (const sel of [`[data-accent="${id}"]`, `.dark[data-accent="${id}"]`]) {
      const block = blocks.get(sel);
      expect(block, sel).toBeDefined();
      for (const v of ACCENT_VARS)
        expect(block?.[v], `${sel} ${v}`).toBeDefined();
    }
  });

  it("lets a .light wrapper redeclare the light theme", () => {
    expect(blocks.get(".light")).toBe(blocks.get(":root"));
  });

  it.each(
    listAccents()
      .map((a) => a.id)
      .filter((id) => id !== "blue"),
  )("%s also reaches .light and .dark wrappers", (id) => {
    const acc = `[data-accent="${id}"]`;
    expect(blocks.get(`${acc} .light`)).toBe(blocks.get(acc));
    expect(blocks.get(`${acc} .dark`)).toBe(blocks.get(`.dark${acc}`));
  });

  it("matches each swatch to its CSS --primary", () => {
    for (const a of listAccents()) {
      expect(parseOklch(a.swatch.light)).toEqual(
        parseOklch(resolveVar(themeVars(blocks, false, a.id), "--primary")),
      );
      expect(parseOklch(a.swatch.dark)).toEqual(
        parseOklch(resolveVar(themeVars(blocks, true, a.id), "--primary")),
      );
    }
  });
});
