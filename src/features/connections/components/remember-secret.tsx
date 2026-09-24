import { WEB } from "@/shared/api/web";
import { Checkbox } from "@/shared/components/ui/checkbox";

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
    <label className="text-muted-foreground flex items-center gap-2 text-xs">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        aria-label="Remember password in this browser"
      />
      Remember the password in this browser (saved as plain text, readable by
      any script on this page)
    </label>
  );
}
