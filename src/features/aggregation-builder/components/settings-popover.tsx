import { useState } from "react";
import { Settings2 } from "lucide-react";
import { useStudioStore, type AggregationSetup } from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Separator } from "@/shared/components/ui/separator";
import { Switch } from "@/shared/components/ui/switch";

/** The builder's settings: this tab's preview and Run options, and the app
 *  wide limit on parallel preview queries. */
export function SettingsPopover({
  id,
  setup,
  onChange,
}: {
  /** Prefix for the field ids, unique per tab. */
  id: string;
  setup: AggregationSetup;
  onChange: (patch: Partial<AggregationSetup>) => void;
}) {
  const concurrency = useStudioStore((s) => s.previewConcurrency);
  const setConcurrency = useStudioStore((s) => s.setPreviewConcurrency);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Builder settings"
            title="Builder settings"
          >
            <Settings2 className="size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="end" className="flex w-72 flex-col gap-3 p-3">
        <p className="text-small font-medium">This tab</p>
        <ToggleSetting
          id={`${id}-auto`}
          label="Auto preview"
          hint="Refresh the cards after you stop typing."
          checked={setup.auto_preview}
          onChange={(v) => onChange({ auto_preview: v })}
        />
        <NumberSetting
          id={`${id}-cap`}
          label="Preview input"
          unit="docs"
          hint="Previews read this many documents from the collection."
          value={setup.preview_cap}
          min={100}
          max={100_000}
          onChange={(n) => onChange({ preview_cap: n })}
        />
        <NumberSetting
          id={`${id}-time`}
          label="Preview time limit"
          unit="s"
          hint="A card that takes longer shows a time limit error."
          value={setup.preview_time_ms / 1000}
          min={1}
          max={120}
          onChange={(n) => onChange({ preview_time_ms: n * 1000 })}
        />
        <ToggleSetting
          id={`${id}-disk`}
          label="Allow disk use"
          hint="Lets Run spill large sorts and groups to disk."
          checked={setup.allow_disk_use}
          onChange={(v) => onChange({ allow_disk_use: v })}
        />
        <Separator />
        <p className="text-small font-medium">All builders</p>
        <NumberSetting
          id={`${id}-parallel`}
          label="Parallel preview queries"
          hint="How many cards a refresh previews at once."
          value={concurrency}
          min={1}
          max={8}
          onChange={setConcurrency}
        />
      </PopoverContent>
    </Popover>
  );
}

function ToggleSetting({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-small">
          {label}
        </Label>
        <span className="text-muted-foreground text-caption">{hint}</span>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** A whole number kept within `min` and `max`, saved on blur or Enter. */
function NumberSetting({
  id,
  label,
  unit,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  unit?: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const parsed = Math.round(Number(text));
    const n = Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : value;
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="text-small">
          {label}
        </Label>
        <span className="text-muted-foreground text-caption">
          {hint} {min.toLocaleString()} to {max.toLocaleString()}.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="text-small h-6 w-20 px-1.5 tabular-nums"
        />
        {unit && (
          <span className="text-muted-foreground text-caption w-7">{unit}</span>
        )}
      </div>
    </div>
  );
}
