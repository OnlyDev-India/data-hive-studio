import {
  ChevronDown,
  ChevronUp,
  Copy,
  Maximize,
  Search,
  Pencil,
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
  /** True when the viewer is in edit mode (the pencil is active). */
  editable: boolean;
  /** Row can't be edited (no write-back hook) — disable the pencil. */
  editDisabled?: boolean;
  onToggleEdit: () => void;
}

/** Toolbar shared by the sidebar viewer and the expanded dialog: search (the
 *  magnifier lives inside the search box), word-wrap toggle, edit toggle,
 *  copy, expand and close. */
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
  editable,
  editDisabled,
  onToggleEdit,
}: TreeControlsProps) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1.5 max-h-8.5">
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
          className="h-6 w-full min-w-0 pl-6 text-xs"
        />
      </label>
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
        className={cn("size-5", wrap && "bg-primary/60 text-foreground")}
        aria-label="Toggle word wrap"
        title={wrap ? "Word wrap on" : "Word wrap off"}
        onClick={onToggleWrap}
      >
        <WrapText className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        disabled={editDisabled}
        className={cn(
          "size-5",
          editable && !editDisabled && "bg-primary/60 text-foreground",
        )}
        aria-label={editable ? "Stop editing" : "Edit row JSON"}
        title={
          editDisabled
            ? "This row is read-only"
            : editable
              ? "Editing (click again to stop)"
              : "Edit row JSON"
        }
        onClick={onToggleEdit}
      >
        <Pencil className="size-3.5" />
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
