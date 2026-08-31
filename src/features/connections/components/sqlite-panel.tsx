import { FolderOpen } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { CardDescription } from "@/shared/components/ui/card";

export function SqlitePanel({
  opening,
  onOpen,
  path,
}: {
  opening: boolean;
  onOpen: () => void;
  /** Pre-selected file path to open (from a recent connection). */
  path?: string | null;
}) {
  return (
    <>
      <CardDescription>
        Load an existing .db file from your device — changes persist in place.
      </CardDescription>
      {path ? (
        <p className="text-muted-foreground max-w-full truncate px-1 text-sm">
          <span className="font-medium">File:</span> {path}
        </p>
      ) : null}
      <Button variant="outline" onClick={onOpen} disabled={opening}>
        <FolderOpen className="size-4" />
        {opening ? "Opening…" : path ? "Browse another…" : "Browse…"}
      </Button>
    </>
  );
}
