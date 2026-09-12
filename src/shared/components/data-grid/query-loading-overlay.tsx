import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export function QueryLoadingOverlay({ onStop }: { onStop: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = setInterval(
      () => setElapsed((performance.now() - start) / 1000),
      100,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <div className="bg-background/80 absolute inset-0 z-80 flex flex-col items-center justify-center gap-3">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading… · {elapsed.toFixed(2)}s</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onStop}
        className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 gap-2"
      >
        <span className="bg-destructive inline-block size-2.5 rounded-[2px]" />
        Stop query
      </Button>
    </div>
  );
}
