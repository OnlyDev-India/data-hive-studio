import { useEffect, useState } from "react";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

/** `startedAt` is a `performance.now()` timestamp owned by the CALLER, not
 *  this component's own mount time — see the caller's own doc comment
 *  (table-pane.tsx/mongo-collection-pane.tsx) for why the loading state
 *  this reflects can't just be "this component is currently mounted".
 *  `onStop` shows a Stop button; leave it out when the wait can't be given
 *  up on (a schema Apply, the structure fetch). `stopping` keeps the button
 *  disabled while the database confirms the stop. */
export function QueryLoadingOverlay({
  startedAt,
  onStop,
  stopping = false,
}: {
  startedAt: number;
  onStop?: () => void;
  stopping?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed((performance.now() - startedAt) / 1000);
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <div className="bg-background/80 absolute inset-0 z-8 flex flex-col items-center justify-center gap-3">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading… · {elapsed.toFixed(2)}s</span>
      </div>
      {onStop && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onStop}
          disabled={stopping}
          className={
            "bg-destructive/30 text-destructive hover:bg-destructive/40"
          }
        >
          {stopping ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Square className="size-3" />
          )}
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      )}
    </div>
  );
}
