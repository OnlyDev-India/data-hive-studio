/** "4.2s" / "850ms" / "2m 5s": the time a run took before it was stopped. */
export function formatStoppedDuration(elapsed_ms: number): string {
  if (elapsed_ms < 1000) return `${Math.max(0, Math.round(elapsed_ms))}ms`;
  const seconds = elapsed_ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds - minutes * 60)}s`;
}

/** The result strip's status line for a run the user stopped, e.g.
 *  "Stopped after 4.2s, 1,200 rows loaded". Rows are the ones that had
 *  already arrived in the grid when Stop landed. */
export function stoppedStatusLine(
  elapsed_ms: number,
  rows_loaded: number,
): string {
  const after = `Stopped after ${formatStoppedDuration(elapsed_ms)}`;
  if (rows_loaded === 0) return `${after}, no rows loaded`;
  const rows = rows_loaded.toLocaleString("en-US");
  return `${after}, ${rows} ${rows_loaded === 1 ? "row" : "rows"} loaded`;
}

/** Extra note shown next to the status line: the database did not confirm
 *  the cancel within 3 seconds, so the tab freed up anyway (AC-9). */
export const WINDING_DOWN_NOTE = "Stopped, the database is still winding it down";

/** Extra note for a stopped MongoDB console run: MongoDB has no rollback
 *  here, so anything a stopped write already changed stays changed. Shown on
 *  every stopped console run (spec 0006, AC-8). */
export const MONGO_WRITE_NOTE = "Documents already changed by a write stay changed";

/** Whether a console command may write (insert, update, delete, replace,
 *  findOneAnd..., bulkWrite, index or collection changes). A stopped one can
 *  have changed data, so open grids on the collection should refresh. */
export function looksLikeMongoWrite(command: string): boolean {
  return /\.\s*(insert|update|delete|replace|remove|save|findOneAnd|bulkWrite|drop|create|rename)[A-Za-z]*\s*\(/i.test(
    command,
  );
}
