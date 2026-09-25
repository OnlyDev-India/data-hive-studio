import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

export const DESIGNER_TABS = [
  ["columns", "Columns"],
  ["indexes", "Indexes"],
  ["foreign-keys", "Foreign Keys"],
  ["constraints", "Constraints"],
] as const;
export type DesignerTab = (typeof DESIGNER_TABS)[number][0];

const GAP = 4;
/** Room the "more" button needs, so the tabs beside it are counted against
 *  what is left. */
const MORE_WIDTH = 32;

/** Which tabs show and which go in the dropdown. As many as fit stay visible,
 *  in order. A selected tab that would be hidden takes the place of the last
 *  visible one, and that one moves into the dropdown. */
export function arrangeTabs<T extends string>(
  order: readonly T[],
  widths: Record<T, number>,
  available: number,
  active: T,
): { visible: T[]; hidden: T[] } {
  const total =
    order.reduce((n, t) => n + widths[t], 0) + GAP * (order.length - 1);
  let fit = order.length;
  if (total > available) {
    fit = 0;
    let used = MORE_WIDTH;
    for (const t of order) {
      used += widths[t] + GAP;
      if (used > available) break;
      fit++;
    }
    fit = Math.max(1, fit);
  }
  const visible = order.slice(0, fit);
  const at = order.indexOf(active);
  if (at >= fit) visible[fit - 1] = active;
  return { visible, hidden: order.filter((t) => !visible.includes(t)) };
}

/** The segmented switch between the parts of a table. When the space is too
 *  small, the tabs that do not fit collapse into a dropdown. `counts` shows
 *  how many items a tab holds once it has any. */
export function TabBar<T extends string = DesignerTab>({
  tabs = DESIGNER_TABS as unknown as readonly (readonly [T, string])[],
  value,
  onChange,
  counts,
}: {
  /** The tabs to show, in order. Defaults to the new table designer's. */
  tabs?: readonly (readonly [T, string])[];
  value: T;
  onChange: (t: T) => void;
  counts: Partial<Record<T, number>>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(Infinity);
  const [widths, setWidths] = useState<Record<T, number> | null>(null);

  // Every tab is drawn once, invisibly, so its width is known whether or not
  // it is currently shown. A tab page can be mounted while hidden, where every
  // width reads 0, so measuring repeats whenever the probe or the bar gets a
  // real size (it is shown, a badge count changes, the font loads) and zero
  // readings are ignored.
  useLayoutEffect(() => {
    const boxEl = box.current;
    const probeEl = probe.current;
    if (!boxEl || !probeEl) return;
    const measure = () => {
      // 8px for the bar's own padding.
      setAvailable(boxEl.clientWidth - 8);
      const next = {} as Record<T, number>;
      for (const el of Array.from(probeEl.children) as HTMLElement[]) {
        next[el.dataset.tab as T] = el.offsetWidth;
      }
      if (tabs.some(([id]) => !next[id])) return;
      setWidths((w) =>
        w && tabs.every(([id]) => w[id] === next[id]) ? w : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(boxEl);
    ro.observe(probeEl);
    return () => ro.disconnect();
  }, [tabs]);

  const order = tabs.map(([id]) => id);
  const { visible, hidden } = widths
    ? arrangeTabs(order, widths, available, value)
    : { visible: order, hidden: [] as T[] };
  const label = (id: T) => tabs.find(([t]) => t === id)?.[1] ?? id;
  const tabButton = (id: T, probing = false) => {
    const n = counts[id] ?? 0;
    return (
      <button
        key={id}
        type="button"
        data-tab={id}
        {...(probing
          ? { tabIndex: -1 }
          : {
              role: "tab",
              "aria-selected": value === id,
              onClick: () => onChange(id),
            })}
        className={cn(
          "rounded-md border border-transparent px-3 py-1 text-sm whitespace-nowrap transition-colors",
          !probing && value === id
            ? "bg-background text-foreground border-border font-medium"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label(id)}
        {n > 0 && (
          <span className="text-muted-foreground ml-1.5 text-xs">{n}</span>
        )}
      </button>
    );
  };

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <div
        role="tablist"
        className="bg-muted/50 flex w-fit max-w-full items-center gap-1 rounded-lg p-1"
      >
        {visible.map((id) => tabButton(id))}
        {hidden.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="More tabs"
                  title="More tabs"
                >
                  <ChevronDown className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {hidden.map((id) => (
                <DropdownMenuItem key={id} onClick={() => onChange(id)}>
                  {label(id)}
                  {(counts[id] ?? 0) > 0 && (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {counts[id]}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {/* Width probe: same buttons, never seen or focused. */}
      <div
        ref={probe}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex w-max gap-1 p-1"
      >
        {order.map((id) => tabButton(id, true))}
      </div>
    </div>
  );
}
