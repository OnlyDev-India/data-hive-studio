import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/** `startedAt` is a `performance.now()` timestamp owned by the CALLER, not
 *  this component's own mount time — see the caller's own doc comment
 *  (table-pane.tsx/mongo-collection-pane.tsx) for why the loading state
 *  this reflects can't just be "this component is currently mounted". */
export function QueryLoadingOverlay({ startedAt }: { startedAt: number }) {
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
    </div>
  );
}
