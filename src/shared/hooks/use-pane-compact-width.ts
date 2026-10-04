import { useEffect, useState, type RefObject } from "react";

// ponytail: one fixed pixel threshold for the whole PANE (not just this bar)
// rather than a per-button collapse order (dbx's
// dataGridToolbarActionCollapseCount) — good enough since this bar has at
// most 5 labeled controls; revisit with a real collapse order if it ever
// grows past that. Deliberately not calibrated against this bar's OWN
// rendered width (see `usePaneCompactWidth`'s doc comment for why that's
// the wrong measurement) — this is "how wide is the whole pane," so it
// needs to be bigger than just the toolbar's own content would.
const PANE_COMPACT_BELOW_PX = 920;
const ONE_BUTTON_MIN_SHRINK = 30;

/** Watches `ref`'s element (the owning PANE, not the toolbar itself — see
 *  `GridActionBar`'s own doc comment) and reports, per element, whether it's
 *  narrower than `paneCompactBelowPx` minus `index * oneButtonMinShrink`.
 *  Shared by the grid, schema and diagram toolbars. */
export function usePaneCompactWidth(
  ref: RefObject<HTMLElement | null>,
  noOfElements: number,
  paneCompactBelowPx: number = PANE_COMPACT_BELOW_PX,
  oneButtonMinShrink: number = ONE_BUTTON_MIN_SHRINK,
) {
  const [compact, setCompact] = useState(Array(noOfElements).fill(false));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // A background tab's pane is `display:none` while inactive, which
      // reports a 0 width here — not a real "very narrow" measurement, just
      // "not visible right now." Recomputing off that would collapse every
      // button to icon-only while hidden, then immediately expand them back
      // on the very next real measurement when the tab is switched back to
      // — exactly the flash this guard avoids, by just keeping whatever was
      // last computed from an actual visible width.
      if (entry && entry.contentRect.width > 0)
        setCompact((prev) => {
          // entry.contentRect.width < PANE_COMPACT_BELOW_PX;
          const new_compact = prev.map(
            (_, index) =>
              entry.contentRect.width <
              paneCompactBelowPx - index * oneButtonMinShrink,
          );
          return new_compact;
        });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, paneCompactBelowPx, oneButtonMinShrink]);
  return compact;
}
