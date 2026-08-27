import { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import type { JsonLine } from "./json-lines";

export interface TreeBodyProps {
  lines: JsonLine[];
  collapsed: Set<string>;
  toggle: (id: string) => void;
  searching: boolean;
  activeLineId: string | undefined;
  wrap: boolean;
  query: string;
}

/** The scrollable JSON tree — shared between the sidebar and the dialog. */
export function TreeBody({
  lines,
  collapsed,
  toggle,
  searching,
  activeLineId,
  wrap,
  query,
}: TreeBodyProps) {
  const lineEls = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!searching || !activeLineId) return;
    lineEls.current[activeLineId]?.scrollIntoView({ block: "nearest" });
  }, [searching, activeLineId]);

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto py-2">
      {lines.map((line, i) => (
        <div
          key={line.id}
          ref={(el) => {
            lineEls.current[line.id] = el;
          }}
          className={cn(
            "group hover:bg-muted/40 flex",
            searching && activeLineId === line.id && "bg-accent",
            wrap ? "items-start" : "min-w-max items-center",
          )}
        >
          <span
            className={cn(
              "text-muted-foreground/50 flex w-10 shrink-0 items-center font-mono text-[11px] leading-5 select-none",
              !wrap &&
                "bg-background group-hover:bg-muted/40 sticky left-0 z-10",
              !wrap && searching && activeLineId === line.id && "bg-accent",
            )}
          >
            <span className="min-w-0 flex-1 pr-1 text-right">{i + 1}</span>
            {!searching && line.segs[0]?.caret ? (
              <Button
                variant="ghost"
                size="iconXs"
                className="text-muted-foreground hover:text-foreground size-3"
                aria-label="Toggle value"
                onClick={() => toggle(line.id)}
              >
                <ChevronRight
                  className={cn(
                    "size-3 transition-transform",
                    !collapsed.has(line.id) && "rotate-90",
                  )}
                />
              </Button>
            ) : (
              <span className="w-3 shrink-0" aria-hidden />
            )}
          </span>
          <span
            className={cn(
              "text-foreground font-mono text-xs leading-5",
              wrap
                ? "min-w-0 flex-1 [overflow-wrap:anywhere] whitespace-pre-wrap"
                : "whitespace-pre",
            )}
            style={{ paddingLeft: line.depth * 12 }}
          >
            <HighlightedLine
              line={line}
              query={searching ? query.trim() : ""}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Render a JSON line with its syntax colors, wrapping every occurrence of the
 * query in a highlight. A match may span multiple colored segments. */
function HighlightedLine({ line, query }: { line: JsonLine; query: string }) {
  const needle = query.toLowerCase();
  const segs = line.segs.filter((s) => !s.caret);
  if (!needle) {
    return (
      <>
        {segs.map((s, i) => (
          <span key={i} className={s.cls}>
            {s.text}
          </span>
        ))}
      </>
    );
  }
  const full = segs.map((s) => s.text ?? "").join("");
  const lower = full.toLowerCase();
  const ranges: [number, number][] = [];
  let i = 0;
  while (true) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) break;
    ranges.push([idx, idx + needle.length]);
    i = idx + needle.length;
  }
  if (ranges.length === 0) {
    return (
      <>
        {segs.map((s, i) => (
          <span key={i} className={s.cls}>
            {s.text}
          </span>
        ))}
      </>
    );
  }

  const out: React.ReactNode[] = [];
  let pos = 0;
  let r = 0;
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const start = pos;
    const end = pos + (seg.text ?? "").length;
    while (r < ranges.length && ranges[r][1] <= start) r++;
    const nodes: React.ReactNode[] = [];
    let cursor = start;
    let rr = r;
    while (rr < ranges.length && ranges[rr][0] < end) {
      const [ms, me] = ranges[rr];
      if (ms > cursor) {
        nodes.push(
          <span key={`t${cursor}`}>
            {seg.text?.slice(cursor - start, ms - start)}
          </span>,
        );
      }
      nodes.push(
        <mark
          key={`m${ms}`}
          className="rounded-[1px] bg-yellow-300/60 text-inherit"
        >
          {seg.text?.slice(
            Math.max(ms, start) - start,
            Math.min(me, end) - start,
          )}
        </mark>,
      );
      cursor = Math.max(cursor, me);
      rr++;
    }
    if (cursor < end)
      nodes.push(
        <span key={`t${cursor}`}>{seg.text?.slice(cursor - start)}</span>,
      );
    out.push(
      <span key={si} className={seg.cls}>
        {nodes}
      </span>,
    );
    r = rr;
    pos = end;
  }
  return <>{out}</>;
}
