/** A file over this size is refused before it is read (spec 0008, AC-13). */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
/** A file with more data rows than this is refused before anything is sent. */
export const MAX_DATA_ROWS = 200_000;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
