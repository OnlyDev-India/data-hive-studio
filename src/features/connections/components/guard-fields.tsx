import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  ENV_COLORS,
  ENV_LABEL_MAX,
  ENV_PRESETS,
  isProductionEnv,
} from "@/shared/api";
import { EnvChip, envChipStyle } from "@/shared/components/env-chip";
import { cn } from "@/shared/lib/utils";
import {
  DEFAULT_CUSTOM_COLOR,
  envModeOf,
  guardFromForm,
  type GuardFormValues,
} from "../lib/guard-form";
import { ReadOnlySwitch } from "./read-only-switch";
import { InfoTip } from "./info-tip";

const NONE = "none";
const CUSTOM = "custom";

/** The whole "how careful to be" section of a connection form (spec 0007):
 *  the Read only switch, the environment (a preset or your own name and
 *  colour), and Confirm before writes. It owns no state, the form's own
 *  values do, so a saved connection loads into it like any other field. */
export function GuardFields({
  idPrefix,
  value,
  onChange,
}: {
  /** Unique per form, so each label points at its own control. */
  idPrefix: string;
  value: GuardFormValues;
  /** Only the fields that changed. */
  onChange: (patch: Partial<GuardFormValues>) => void;
}) {
  const mode = envModeOf(value);
  const production = isProductionEnv(value);
  const custom = mode === CUSTOM;
  const select_id = `${idPrefix}-env`;
  const name_id = `${idPrefix}-env-name`;
  const confirm_id = `${idPrefix}-confirm-writes`;

  const pick_mode = (next: string | null) => {
    if (next === CUSTOM) {
      // A custom environment starts with a real colour, which is what marks
      // it as chosen while its name is still empty.
      if (!custom) onChange({ env_label: "", env_color: DEFAULT_CUSTOM_COLOR });
    } else if (!next || next === NONE) {
      onChange({ env_label: "", env_color: "" });
    } else {
      onChange({ env_label: next, env_color: "" });
    }
  };

  return (
    <div className="grid gap-3">
      <ReadOnlySwitch
        id={`${idPrefix}-read-only`}
        checked={value.read_only}
        onCheckedChange={(read_only) => onChange({ read_only })}
      />

      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor={select_id} className="text-sm font-normal">
            Environment
          </Label>
          <Select value={mode} onValueChange={pick_mode}>
            <SelectTrigger id={select_id} className="w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={NONE}>None</SelectItem>
                {ENV_PRESETS.map((p) => (
                  <SelectItem key={p.label} value={p.label}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom…</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <EnvChip conn={guardFromForm(value)} />
        </div>

        {custom && (
          <div className="grid gap-2">
            <Input
              id={name_id}
              aria-label="Environment name"
              placeholder="Environment name, for example QA"
              maxLength={ENV_LABEL_MAX}
              value={value.env_label}
              onChange={(e) => onChange({ env_label: e.target.value })}
            />
            <div
              role="radiogroup"
              aria-label="Environment colour"
              className="flex flex-wrap items-center gap-2"
            >
              {ENV_COLORS.map((color) => {
                const selected =
                  (value.env_color || DEFAULT_CUSTOM_COLOR) === color;
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={color}
                    title={color}
                    style={envChipStyle(color)}
                    onClick={() => onChange({ env_color: color })}
                    className={cn(
                      "focus-visible:ring-ring/50 size-5 rounded-full border outline-none focus-visible:ring-[3px]",
                      selected &&
                        "ring-foreground ring-offset-background ring-2 ring-offset-2",
                    )}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Checkbox
          id={confirm_id}
          // Production always asks, so the box shows on and cannot be turned
          // off while that label is picked. The stored choice is kept for
          // when the label changes.
          checked={production || value.confirm_writes}
          disabled={production}
          onCheckedChange={(checked) => onChange({ confirm_writes: checked })}
        />
        <Label htmlFor={confirm_id} className="text-sm font-normal">
          Confirm before writes
        </Label>
        <InfoTip label="Confirm before writes">
          {production
            ? "Always on for Production."
            : "Ask before every change to this connection's data or schema."}
        </InfoTip>
      </div>
    </div>
  );
}
