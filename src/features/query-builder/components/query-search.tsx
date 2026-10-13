import type { Ref } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

/** The toolbar's search box: Enter and Shift+Enter step through the
 *  matches, Escape clears. */
export function QuerySearch({
  inputRef,
  text,
  onText,
  count,
  at,
  onStep,
}: {
  inputRef: Ref<HTMLInputElement>;
  text: string;
  onText: (text: string) => void;
  count: number;
  /** The match last panned to, or -1 before the first step. */
  at: number;
  onStep: (dir: 1 | -1) => void;
}) {
  const searching = text.trim().length > 0;
  return (
    <div className="flex items-center gap-0.5">
      <div className="relative w-44">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          ref={inputRef}
          type="search"
          aria-label="Search queries"
          placeholder="Search queries…"
          className="text-small h-7 pr-2 pl-7"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape" && text) {
              e.preventDefault();
              e.stopPropagation();
              onText("");
            }
          }}
        />
      </div>
      {searching && (
        <>
          <span
            role="status"
            className="text-muted-foreground text-small px-1 whitespace-nowrap tabular-nums"
          >
            {count === 0
              ? "No matches"
              : at < 0
                ? `${count} ${count === 1 ? "match" : "matches"}`
                : `${at + 1} of ${count}`}
          </span>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Previous match"
            title="Previous match (⇧↩)"
            disabled={count === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Next match"
            title="Next match (↩)"
            disabled={count === 0}
            onClick={() => onStep(1)}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}
