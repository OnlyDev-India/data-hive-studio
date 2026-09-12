import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

export interface TreeControlsProps {
  query: string;
  onQueryChange: (q: string) => void;
  searching: boolean;
  matchCount: number;
  activeMatch: number;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
  onClose: () => void;
  /** No row selected — every control except Close is disabled (nothing for
   *  search to act on). */
  disabled?: boolean;
}

/** Toolbar shared by the sidebar viewer and the expanded dialog: search (the
 *  magnifier lives inside the search box), match navigation, and close. The
 *  edit/wrap/expand/copy actions live in their own bar, JsonViewerToolbar. */
export function TreeControls({
  query,
  onQueryChange,
  searching,
  matchCount,
  activeMatch,
  onPrev,
  onNext,
  onClear,
  onClose,
  disabled = false,
}: TreeControlsProps) {
  return (
    <div className="flex max-h-8.5 items-center gap-1 border-b px-2 py-1.5">
      <label className="relative min-w-0 flex-1">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.shiftKey) onPrev();
              else onNext();
            }
          }}
          placeholder="Search in row…"
          disabled={disabled}
          className="h-6 w-full min-w-0 pl-6 text-xs"
        />
      </label>
      {searching && (
        <>
          <span className="text-muted-foreground text-2xs shrink-0 tabular-nums">
            {matchCount === 0
              ? "0/0"
              : `${(activeMatch % matchCount) + 1}/${matchCount}`}
          </span>
          <Button
            variant="ghost"
            size="iconXs"
            className="size-5"
            disabled={disabled}
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            onClick={onPrev}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconXs"
            className="size-5"
            disabled={disabled}
            aria-label="Next match"
            title="Next match (Enter)"
            onClick={onNext}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="iconXs"
            className="size-5"
            disabled={disabled}
            aria-label="Clear search"
            title="Clear search"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </Button>
        </>
      )}
      <Button
        variant="ghost"
        size="iconXs"
        className="size-5"
        aria-label="Close"
        title="Close"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
