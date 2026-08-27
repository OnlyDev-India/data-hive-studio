import { FolderOpen } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { CardDescription } from "@/shared/components/ui/card";

export function SqlitePanel({
  opening,
  onOpen,
}: {
  opening: boolean;
  onOpen: () => void;
}) {
  return (
    <>
      <CardDescription>
        Load an existing .db file from your device — changes persist in place.
      </CardDescription>
      <Button variant="outline" onClick={onOpen} disabled={opening}>
        <FolderOpen className="size-4" />
        {opening ? "Opening…" : "Browse…"}
      </Button>
    </>
  );
}
