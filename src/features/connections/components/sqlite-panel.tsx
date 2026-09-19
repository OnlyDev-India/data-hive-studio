import { FolderOpen, Save } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { CardDescription } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";

export interface SqlitePanelProps {
  /** Chosen file path — from Browse, or prefilled from a saved/recent
   *  connection. */
  path: string | null;
  name: string;
  setName: (v: string) => void;

  opening: boolean;
  /** Pick a file. Only chooses it; opening is the separate Open step so the
   *  choice can be saved without connecting. */
  onBrowse: () => void;
  onOpen: () => void;

  /** Editing a saved connection — Save becomes Update, and Cancel appears. */
  editing: boolean;
  onSaveLocal: () => void;
  onCancelEdit: () => void;
}

export function SqlitePanel({
  path,
  name,
  setName,
  opening,
  onBrowse,
  onOpen,
  editing,
  onSaveLocal,
  onCancelEdit,
}: SqlitePanelProps) {
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
      <Input
        placeholder="connection name (optional, defaults to the file name)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-2 pt-1">
        <Button variant="outline" onClick={onBrowse} disabled={opening}>
          <FolderOpen className="size-4" />
          {path ? "Browse another…" : "Browse…"}
        </Button>
        <Button onClick={onOpen} disabled={!path || opening}>
          {opening ? "Opening…" : "Open"}
        </Button>
        {editing ? (
          <>
            <Button variant="secondary" onClick={onSaveLocal} disabled={!path}>
              Update
            </Button>
            <Button variant="outline" onClick={onCancelEdit}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={onSaveLocal}
            disabled={!path}
            title="Save to this device"
          >
            <Save className="size-4" /> Save
          </Button>
        )}
      </div>
    </>
  );
}
