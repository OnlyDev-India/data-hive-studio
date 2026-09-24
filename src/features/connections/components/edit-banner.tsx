import { Pencil, X } from "lucide-react";
import { WEB } from "@/shared/api/web";
import type { LandingEditTarget } from "@/shared/store";

export function EditBanner({
  editing,
  onCancel,
}: {
  editing: LandingEditTarget;
  onCancel: () => void;
}) {
  return (
    <div className="text-foreground flex w-full items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs">
      <Pencil className="size-3.5 shrink-0 text-amber-600" />
      <span>
        Editing <b>{editing.name}</b>
        {" — "}
        saved {WEB ? "in this browser" : "on this device"}
        . Saving updates it.
      </span>
      <button
        className="text-muted-foreground hover:text-destructive ml-auto flex items-center gap-1"
        onClick={onCancel}
      >
        <X className="size-3" /> cancel
      </button>
    </div>
  );
}
