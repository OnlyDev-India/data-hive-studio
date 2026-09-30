import { useEffect, useEffectEvent, useState } from "react";

/** Runs `load` whenever `key` changes (null = don't run) and keeps only the
 *  answer for the current key, so a slow earlier answer never wins. */
export function useAsync<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{
    key: string | null;
    data?: T;
    error?: string;
  }>({ key: null });
  const run = useEffectEvent(load);

  useEffect(() => {
    if (key === null) return;
    let live = true;
    run().then(
      (data) => live && setState({ key, data }),
      (e: unknown) =>
        live &&
        setState({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [key]);

  const cur = state.key === key ? state : { key };
  return {
    data: cur.data ?? null,
    error: cur.error ?? null,
    loading: key !== null && !("data" in cur) && !("error" in cur),
  };
}
