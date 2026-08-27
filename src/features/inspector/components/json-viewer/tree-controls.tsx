import {
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize,
  Search,
  WrapText,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
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
  wrap: boolean;
  onToggleWrap: () => void;
  onCopy: () => void;
  onClose: () => void;
  onExpand?: () => void;
}

/** Toolbar shared by the sidebar viewer and the expanded dialog: search with
 *  match navigation, word-wrap toggle, copy, expand and close. */
export function TreeControls({
  query,
  onQueryChange,
  searching,
  matchCount,
  activeMatch,
  onPrev,
  onNext,
  onClear,
  wrap,
  onToggleWrap,
  onCopy,
  onClose,
  onExpand,
}: TreeControlsProps) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1.5">
      <Search className="text-muted-foreground size-3.5 shrink-0" />
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
        className="h-6 min-w-0 flex-1 px-2 text-xs"
      />
      {searching && (
        <>
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {matchCount === 0
              ? "0/0"
              : `${(activeMatch % matchCount) + 1}/${matchCount}`}
          </span>
          <Button
            variant="ghost"
            size="iconXs"
            className="size-5"
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
        className={cn("size-5", wrap && "bg-muted text-foreground")}
        aria-label="Toggle word wrap"
        title={wrap ? "Word wrap on" : "Word wrap off"}
        onClick={onToggleWrap}
      >
        <WrapText className="size-3.5" />
      </Button>
      {onExpand && (
        <Button
          variant="ghost"
          size="iconXs"
          className="size-5"
          aria-label="Open in dialog"
          title="Open in dialog"
          onClick={onExpand}
        >
          <Maximize className="size-3.5" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="iconXs"
        className="size-5"
        aria-label="Copy row as JSON"
        title="Copy as JSON"
        onClick={onCopy}
      >
        <Copy className="size-3.5" />
      </Button>
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
