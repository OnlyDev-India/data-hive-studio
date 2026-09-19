import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";

/** The Read only switch every connection form shows (spec 0007). The hint
 *  says the honest limit: this stops slips made through DH Studio, and only a
 *  database role with read only grants stops everything. */
export function ReadOnlySwitch({
  id,
  checked,
  onCheckedChange,
}: {
  /** Unique per form, so the label points at its own switch. */
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        aria-label="Read only"
        checked={checked}
        // Only the boolean: the switch also passes event details, which a
        // consumer's setter has no use for.
        onCheckedChange={(next) => onCheckedChange(next)}
      />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="text-sm font-normal">
          Read only
        </Label>
        <p className="text-muted-foreground text-xs">
          DH Studio refuses every write on this connection. A database role with
          read only grants is the only hard guarantee.
        </p>
      </div>
    </div>
  );
}
