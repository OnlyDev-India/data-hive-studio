import { AlertCircle, RefreshCw, Square } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { WEB } from "@/shared/api/web";
import { useAppShortcut } from "@/shared/hooks/use-shortcut";
import { formatBinding } from "@/shared/hooks/shortcut-registry";
import { Kbd, KbdGroup } from "../ui/kbd";

/** What a grid shows in place of rows when its page fetch ended without any:
 *  the user pressed Stop, or the query failed. Both offer the same way out,
 *  reloading, with the reload shortcut spelled out (desktop only: on the web
 *  build the same keys reload the whole page). */
export function GridLoadState({
  kind,
  error,
  on_reload,
}: {
  kind: "stopped" | "error";
  error?: string | null;
  on_reload: () => void;
}) {
  const reload_key = formatBinding(useAppShortcut("grid.reload"));
  const Icon = kind === "stopped" ? Square : AlertCircle;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="flex h-full flex-col items-center justify-center gap-3 px-3 py-8 text-center"
    >
      <Icon
        className={
          kind === "error"
            ? "text-destructive size-5"
            : "text-muted-foreground size-4"
        }
      />
      <p className="text-sm">
        {kind === "stopped" ? "Query stopped." : "Couldn't load the rows."}
      </p>
      {kind === "error" && error && (
        <pre className="border-destructive/30 bg-destructive/5 text-destructive max-h-32 max-w-lg overflow-auto rounded-md border p-2 text-left font-mono text-xs whitespace-pre-wrap">
          {error}
        </pre>
      )}
      <Button size="sm" variant="secondary" onClick={on_reload}>
        <RefreshCw className="size-3.5" />
        Reload
      </Button>
      {!WEB && (
        <p className="text-muted-foreground text-xs">
          or press{" "}
          <KbdGroup>
            {reload_key.map((key, idx) => (
              <Kbd key={idx}>{key}</Kbd>
            ))}
          </KbdGroup>
        </p>
      )}
    </div>
  );
}
