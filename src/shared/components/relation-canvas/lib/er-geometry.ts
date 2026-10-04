import type { GraphColumn } from "@/shared/api/types";

export const ENTITY_WIDTH = 160;
export const ENTITY_HEIGHT = 40;
export const OVAL_HEIGHT = 28;
const OVAL_GAP = 12;
const OVALS_PER_ROW = 4;
export const DIAMOND_HEIGHT = 56;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OvalBox extends Box {
  column: GraphColumn;
}

/** An entity rectangle plus its ovals, placed as one box. */
export interface ClusterGeometry {
  width: number;
  height: number;
  rect: Box;
  ovals: OvalBox[];
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export const ovalWidth = (name: string) => clamp(name.length * 7 + 24, 64, 140);

export const diamondWidth = (label: string) =>
  clamp(label.length * 10 + 40, 96, 240);

function rows(columns: GraphColumn[]): GraphColumn[][] {
  const out: GraphColumn[][] = [];
  for (let i = 0; i < columns.length; i += OVALS_PER_ROW)
    out.push(columns.slice(i, i + OVALS_PER_ROW));
  return out;
}

const rowWidth = (row: GraphColumn[]) =>
  row.reduce((w, c) => w + ovalWidth(c.name), 0) + (row.length - 1) * OVAL_GAP;

/** Ovals sit in rows above and below the rectangle, never beside it, so the
 *  left and right sides stay free for lines. The top rows take the first
 *  half of the columns. */
export function clusterGeometry(columns: GraphColumn[]): ClusterGeometry {
  const half = Math.ceil(columns.length / 2);
  const top = rows(columns.slice(0, half));
  const bottom = rows(columns.slice(half));
  const all = [...top, ...bottom];
  const width = Math.max(ENTITY_WIDTH, ...all.map(rowWidth));
  const band = OVAL_HEIGHT + OVAL_GAP;
  const rectY = top.length * band;
  const ovals: OvalBox[] = [];
  const place = (row: GraphColumn[], y: number) => {
    let x = (width - rowWidth(row)) / 2;
    for (const column of row) {
      const w = ovalWidth(column.name);
      ovals.push({ column, x, y, width: w, height: OVAL_HEIGHT });
      x += w + OVAL_GAP;
    }
  };
  top.forEach((row, i) => place(row, i * band));
  bottom.forEach((row, i) =>
    place(row, rectY + ENTITY_HEIGHT + OVAL_GAP + i * band),
  );
  return {
    width,
    height: rectY + ENTITY_HEIGHT + bottom.length * band,
    rect: {
      x: (width - ENTITY_WIDTH) / 2,
      y: rectY,
      width: ENTITY_WIDTH,
      height: ENTITY_HEIGHT,
    },
    ovals,
  };
}
