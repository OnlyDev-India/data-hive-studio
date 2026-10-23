import { useEffect, useState } from "react";

/** Whether the window is visible (not minimized, not a background tab). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const on_change = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on_change);
    return () => document.removeEventListener("visibilitychange", on_change);
  }, []);
  return visible;
}

/** `Date.now()`, ticking every second while `ticking`, for `Updated Ns ago`.
 *  The first tick lands at once, so a fresh answer never shows a stale age. */
export function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ticking]);
  return now;
}
