import { DatabasePlus, GripHorizontal } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useCardDragContext } from "./use-card-drag";

export function ConnectionCard({
  title,
  showNew,
  onNew,
  tabs,
  footer,
  status,
  children,
}: {
  title: React.ReactNode;
  showNew: boolean;
  onNew: () => void;
  tabs?: React.ReactNode;
  footer: React.ReactNode;
  /** A line under the footer, such as a test result. */
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  const drag = useCardDragContext();
  const offset = drag?.offset ?? { x: 0, y: 0 };

  return (
    <section
      ref={drag?.attachCard}
      aria-label={typeof title === "string" ? title : "Connection"}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className="bg-card text-card-foreground @container flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-lg"
    >
      <header
        {...drag?.handleProps}
        className="flex shrink-0 cursor-grab touch-none items-center gap-2 border-b px-4 py-2.5 select-none active:cursor-grabbing"
      >
        <GripHorizontal
          aria-hidden
          className="text-muted-foreground/60 size-4 shrink-0"
        />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </h2>
        {showNew && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onNew}
            title="Start a fresh connection"
          >
            <DatabasePlus className="size-3.5" />
            New connection
          </Button>
        )}
      </header>
      {tabs && <div className="shrink-0 px-4 pt-3">{tabs}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      <footer className="bg-muted/30 flex shrink-0 flex-col gap-2 border-t px-4 py-3">
        <div className="flex items-center gap-2">{footer}</div>
        {status}
      </footer>
    </section>
  );
}
