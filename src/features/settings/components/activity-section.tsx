import { Switch } from "@/shared/components/ui/switch";
import { Label } from "@/shared/components/ui/label";
import { useStudioStore } from "@/shared/store";

export function ActivitySection() {
  const save_app = useStudioStore((s) => s.saveAppActivity);
  const setSaveApp = useStudioStore((s) => s.setSaveAppActivity);

  return (
    <div className="flex h-full flex-col gap-6">
      <header>
        <h2 className="text-heading font-semibold">Activity log</h2>
        <p className="text-muted-foreground text-body mt-0.5">
          What the activity history keeps. It holds your last 500 entries.
        </p>
      </header>

      <div className="bg-muted/40 rounded-dialog flex items-start justify-between gap-4 border p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="save-app-activity" className="text-body font-medium">
            Save app queries
          </Label>
          <p className="text-muted-foreground text-small">
            Also record the app's own background queries, like table browsing,
            schema lookups and connects.
          </p>
        </div>
        <Switch
          id="save-app-activity"
          checked={save_app}
          onCheckedChange={(checked) => setSaveApp(checked)}
          className="mt-0.5"
        />
      </div>
    </div>
  );
}
