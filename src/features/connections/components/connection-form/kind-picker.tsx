import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { SavedDbKind } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { ConnectionCard } from "./connection-card";
import { KIND_ITEMS, kindItem } from "./kinds";

export function KindPicker({
  selected,
  onSelect,
  onNext,
  showNew,
  onNew,
}: {
  selected: SavedDbKind;
  onSelect: (kind: SavedDbKind) => void;
  onNext: () => void;
  showNew: boolean;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = KIND_ITEMS.filter((i) => i.label.toLowerCase().includes(q));
  const current = kindItem(selected);

  const choose = (kind: SavedDbKind) => {
    onSelect(kind);
    onNext();
  };

  return (
    <ConnectionCard
      title="New Connection"
      showNew={showNew}
      onNew={onNew}
      footer={
        <>
          <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
            Selected:
            <current.icon aria-hidden className="size-4 shrink-0" />
            <span className="text-foreground truncate font-medium">
              {current.label}
            </span>
          </span>
          <Button
            className="ml-auto"
            onClick={onNext}
            disabled={visible.length === 0}
          >
            Next
            <ArrowRight className="size-3.5" />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            autoFocus
            aria-label="Search database types"
            placeholder="Search database types"
            className="h-8 pl-8 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && visible[0]) choose(visible[0].id);
            }}
          />
        </div>
        {visible.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
            No match.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Database type"
            className="grid grid-cols-2 gap-3 @[30rem]:grid-cols-4"
          >
            {visible.map(({ id, label, icon: Icon }) => {
              const on = id === selected;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onSelect(id)}
                  onDoubleClick={() => choose(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      choose(id);
                    }
                  }}
                  className={cn(
                    "focus-visible:ring-ring/50 flex flex-col items-center gap-3 rounded-lg border px-3 py-5 text-center text-sm transition-colors outline-none focus-visible:ring-[3px]",
                    on
                      ? "border-primary bg-primary/5 ring-primary ring-1"
                      : "hover:bg-accent/60",
                  )}
                >
                  <span className="bg-muted flex size-12 items-center justify-center rounded-xl">
                    <Icon aria-hidden className="size-7" />
                  </span>
                  <span className="leading-tight font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ConnectionCard>
  );
}
