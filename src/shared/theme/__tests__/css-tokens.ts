import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(__dirname, "../../../..");

export function readProjectFile(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

type Vars = Record<string, string>;

/** Top level blocks of index.css keyed by selector (`:root`, `.dark`,
 *  `[data-accent="purple"]`, ...), each as a map of custom properties. */
export function parseBlocks(css: string): Map<string, Vars> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map<string, Vars>();
  const re = /^([:.[][^{\n]*?)\s*\{([^{}]*)\}/gm;
  for (const m of clean.matchAll(re)) {
    const vars: Vars = {};
    for (const decl of m[2].split(";")) {
      const i = decl.indexOf(":");
      const name = decl.slice(0, i).trim();
      if (name.startsWith("--"))
        vars[name] = decl
          .slice(i + 1)
          .replace(/\s+/g, " ")
          .trim();
    }
    blocks.set(m[1].trim(), vars);
  }
  return blocks;
}

/** The custom properties <html> ends up with for a theme and accent. */
export function themeVars(
  blocks: Map<string, Vars>,
  dark: boolean,
  accent: string,
): Vars {
  const layers = [
    ":root",
    dark && ".dark",
    `[data-accent="${accent}"]`,
    dark && `.dark[data-accent="${accent}"]`,
  ];
  const vars: Vars = {};
  for (const sel of layers) if (sel) Object.assign(vars, blocks.get(sel));
  return vars;
}

export function resolveVar(vars: Vars, name: string): string {
  let value = vars[name];
  for (let i = 0; value?.startsWith("var("); i++) {
    if (i > 10) throw new Error(`var cycle at ${name}`);
    value = vars[value.slice(4, -1).trim()];
  }
  if (value === undefined) throw new Error(`${name} is not defined`);
  return value;
}

/** Parses `oklch(L C H)` (no alpha) into its three numbers. */
export function parseOklch(value: string): [number, number, number] {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!m) throw new Error(`not a plain oklch color: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** WCAG relative luminance of an oklch color, clipped to sRGB. */
export function luminance(value: string): number {
  const [L, C, H] = parseOklch(value);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
