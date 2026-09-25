import { FileUp } from "lucide-react";

interface Props {
  onPick: () => void;
  onDrop: (file: File) => void;
}

/** Step 1: pick the file, by dialog or by dropping it. */
export function SourceStep({ onPick, onDrop }: Props) {
  return (
    <button
      type="button"
      className="hover:bg-muted/50 flex h-48 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm"
      onClick={onPick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onDrop(f);
      }}
    >
      <FileUp className="size-5" />
      Choose a file, or drop one here
      <span className="text-muted-foreground text-xs">
        CSV, JSON, JSON Lines or Excel (.xlsx)
      </span>
    </button>
  );
}
