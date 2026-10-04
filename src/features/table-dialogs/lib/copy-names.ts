export function uniqueCopyName(
  name: string,
  tables: { name: string }[],
): string {
  const used = new Set(tables.map((t) => t.name));
  if (!used.has(`${name}_copy`)) return `${name}_copy`;
  let i = 2;
  while (used.has(`${name}_copy_${i}`)) i += 1;
  return `${name}_copy_${i}`;
}

/** `<name>_<YYYYMMDD_HHmmss>` — the default name MongoDB's "Duplicate
 *  collection" dialog prefills (distinct from the SQL `_copy` suffix; a
 *  timestamp practically never collides, but fall back to `uniqueCopyName`'s
 *  numbered-suffix approach on the off chance two duplicates land in the
 *  same second). */
export function timestampedCopyName(
  name: string,
  tables: { name: string }[],
): string {
  const used = new Set(tables.map((t) => t.name));
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const base = `${name}_${stamp}`;
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}
