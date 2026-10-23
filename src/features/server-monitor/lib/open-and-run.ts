import { tabKey, useStudioStore, type SqlTarget } from "@/shared/store";

/** How long to wait for the new SQL tab to register before giving up on
 *  running it (the text stays in the tab either way). */
const REGISTER_WAIT_MS = 10_000;

/** Open a new SQL tab seeded with `text` and run it once the tab is ready
 *  (the monitor's Explain, AC-8). */
export function openSqlAndRun(
  conn_id: string,
  text: string,
  target: SqlTarget,
): void {
  const keys = () =>
    new Set(
      (useStudioStore.getState().workspaces[conn_id]?.tabs ?? [])
        .filter((t) => t.kind === "sql")
        .map(tabKey),
    );
  const before = keys();
  useStudioStore.getState().openSql(conn_id, text, undefined, undefined, target);
  const key = [...keys()].find((k) => !before.has(k));
  if (!key) return;

  let done = false;
  const run = (): boolean => {
    const handle = useStudioStore.getState().sqlTabs[key];
    const run_all = handle?.run_all;
    if (done || !handle?.has_text || !run_all) return false;
    done = true;
    void run_all();
    return true;
  };
  if (run()) return;
  const unsubscribe = useStudioStore.subscribe(() => {
    if (run()) unsubscribe();
  });
  setTimeout(() => {
    done = true;
    unsubscribe();
  }, REGISTER_WAIT_MS);
}
