import { WEB } from "@/shared/api/web";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { InfoTip } from "./info-tip";

/** Whether a saved connection keeps its password. Off means connect asks
 *  for it each time and holds it in memory only. */
export function RememberSecret({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label={
            WEB
              ? "Remember password in this browser"
              : "Remember password on this computer"
          }
        />
        Remember password
      </label>
      <InfoTip label="Remember password">
        {WEB
          ? "Saved in this browser as plain text, readable by any script on this page. Off means you type it each time."
          : "Saved on this computer, encrypted. Off means you type it each time you connect."}
      </InfoTip>
    </div>
  );
}
