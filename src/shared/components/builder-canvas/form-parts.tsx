import type { ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

/** Small form controls the builder cards share. */

export function Rows<T>({
  rows,
  add,
  blank,
  onRows,
  render,
  cols = "grid-cols-[1fr_6.5rem_1fr_1.5rem]",
}: {
  rows: T[];
  add: string;
  blank: T;
  onRows: (rows: T[]) => void;
  render: (row: T, set: (row: T) => void) => ReactNode;
  cols?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <div key={i} className={cn("grid items-center gap-1", cols)}>
          {render(r, (row) => onRows(rows.map((x, j) => (j === i ? row : x))))}
          <Button
            variant="ghost"
            size="iconXs"
            className="text-muted-foreground"
            aria-label={`Remove row ${i + 1}`}
            onClick={() => onRows(rows.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground self-start"
        onClick={() => onRows([...rows, blank])}
      >
        <Plus className="size-3" />
        {add}
      </Button>
    </div>
  );
}

export function FormLabel({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-small">{children}</span>;
}

export const INPUT = "text-small h-6 px-2";

export function Text({
  label,
  value,
  onValue,
  placeholder,
  mono,
  inputMode,
}: {
  label: string;
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  inputMode?: "numeric";
}) {
  return (
    <Input
      aria-label={label}
      value={value}
      placeholder={placeholder}
      inputMode={inputMode}
      onChange={(e) => onValue(e.target.value)}
      className={cn(INPUT, mono && "font-mono")}
    />
  );
}

export function Pick({
  label,
  value,
  options,
  onValue,
  mono,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onValue: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onValue(String(v))}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("text-small h-6! w-full", mono && "font-mono")}
      >
        <SelectValue>
          {(v: string) => options.find(([k]) => k === v)?.[1] ?? v}
        </SelectValue>
      </SelectTrigger>
      {/* Aligning the item with the trigger misreads the canvas zoom and
          lands the popup off the card, so it opens below the trigger. */}
      <SelectContent alignItemWithTrigger={false}>
        {options.map(([k, text]) => (
          <SelectItem key={k} value={k} className={cn(mono && "font-mono")}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
