import { WEB } from "@/shared/api/web";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { InfoTip } from "./info-tip";

/** Web build only (spec 0010, AC-4): whether a saved connection keeps its
 *  password in this browser. Off means the page asks for it each time and
 *  holds it in memory only. */
export function RememberSecret({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  if (!WEB) return null;
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onChange(v === true)}
          aria-label="Remember password in this browser"
        />
        Remember password
      </label>
      <InfoTip label="Remember password">
        Saved in this browser as plain text, readable by any script on this
        page. Off means you type it each time.
      </InfoTip>
    </div>
  );
}
