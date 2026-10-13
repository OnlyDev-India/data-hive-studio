import { useId } from "react";
import { ArrowRight, X } from "lucide-react";
import { FormLabel, Pick, Text } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { SET_OPS } from "../../lib/sql-text";

/** A CTE card: its name, an optional column list, and RECURSIVE when its
 *  definition reads itself. The definition is the chain to the right. */
export function CteBody({
  name,
  recursive,
  columns,
  onCte,
}: {
  name: string;
  recursive: boolean;
  columns: string;
  onCte: (c: { name: string; recursive: boolean; columns: string }) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[1fr_1fr] items-center gap-1.5">
        <Text
          label="CTE name"
          value={name}
          placeholder="name, such as recent"
          onValue={(n) => onCte({ name: n, recursive, columns })}
          mono
        />
        <Text
          label="Column names"
          value={columns}
          placeholder="(columns), optional"
          onValue={(c) => onCte({ name, recursive, columns: c })}
          mono
        />
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <Checkbox
          id={id}
          checked={recursive}
          onCheckedChange={(r) => onCte({ name, recursive: !!r, columns })}
        />
        <label htmlFor={id} className="text-small">
          Recursive, reads itself
        </label>
        <span className="text-muted-foreground text-small ml-auto flex items-center gap-1">
          Defined by the subquery
          <ArrowRight className="size-3" />
        </span>
      </div>
    </div>
  );
}

/** A set operation card: the operator; its right side is the chain to the
 *  right. */
export function CompoundBody({
  op,
  onOp,
}: {
  op: string;
  onOp: (op: string) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_8rem_1fr] items-center gap-1.5">
      <FormLabel>Combine with</FormLabel>
      <Pick
        label="Set operation"
        value={op}
        options={SET_OPS.map((o) => [o, o])}
        onValue={onOp}
        mono
      />
      <span className="text-muted-foreground text-small flex items-center justify-end gap-1">
        the query to the right
        <ArrowRight className="size-3" />
      </span>
    </div>
  );
}

/** Where a subquery's value sits in a form: a chip pointing at its chain,
 *  with a way back to a plain value. */
export function SubqueryChip({
  onRemove,
  removeLabel = "Use a value instead",
}: {
  onRemove?: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="bg-muted/60 rounded-control text-small flex h-6 min-w-0 items-center gap-1 border border-dashed pr-0.5 pl-2">
      <span className="truncate font-mono">subquery</span>
      <ArrowRight className="text-muted-foreground size-3 shrink-0" />
      {onRemove && (
        <Button
          variant="ghost"
          size="iconXs"
          className="text-muted-foreground ml-auto size-5"
          aria-label={removeLabel}
          title={removeLabel}
          onClick={onRemove}
        >
          <X className="size-3" />
        </Button>
      )}
    </span>
  );
}
