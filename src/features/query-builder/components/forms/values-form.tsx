import { Braces, Plus, X } from "lucide-react";
import { INPUT } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import type { Column } from "../../lib/columns";
import type { Cell, ValuesForm } from "../../lib/forms/writes";
import { SubqueryChip } from "./chain-forms";

const blank = (): Cell => ({ value: "", kind: null });

/** The VALUES grid: one column per INSERT column, one line per row. Each
 *  cell is written as a literal of its column's type; empty is NULL. */
export function ValuesBody({
  f,
  columns,
  onF,
  newMarker,
}: {
  f: ValuesForm;
  /** The INSERT card's columns in order, else every table column. */
  columns: Column[];
  onF: (f: ValuesForm) => void;
  /** Offers "From a query", given where its marker comes from. */
  newMarker?: () => number;
}) {
  if (f.source !== undefined)
    return (
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-small px-1">
          The rows come from a query
        </span>
        <SubqueryChip
          removeLabel="Type the rows instead"
          onRemove={() => onF({ rows: [] })}
        />
      </div>
    );
  const width = Math.max(columns.length, ...f.rows.map((r) => r.length), 1);
  const pad = (r: Cell[]) =>
    Array.from({ length: width }, (_, i) => r[i] ?? blank());
  const setCell = (i: number, j: number, value: string) =>
    onF({
      rows: f.rows.map((r, k) =>
        k === i
          ? pad(r).map((c, m) => (m === j ? { value, kind: null } : c))
          : r,
      ),
    });
  const template = {
    gridTemplateColumns: `repeat(${width}, minmax(5.5rem, 1fr)) 1.5rem`,
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="overflow-x-auto">
        <div className="grid min-w-max items-center gap-1" style={template}>
          {Array.from({ length: width }, (_, j) => (
            <span
              key={j}
              className="text-muted-foreground text-small truncate px-1 font-mono"
              title={columns[j]?.type ?? undefined}
            >
              {columns[j]?.name ?? `column ${j + 1}`}
            </span>
          ))}
          <span />
          {f.rows.map((r, i) => (
            <Row
              key={i}
              index={i}
              cells={pad(r)}
              columns={columns}
              onCell={(j, v) => setCell(i, j, v)}
              onRemove={() => onF({ rows: f.rows.filter((_, k) => k !== i) })}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            onF({ rows: [...f.rows, Array.from({ length: width }, blank)] })
          }
        >
          <Plus className="size-3" />
          Add row
        </Button>
        {newMarker && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onF({ rows: [], source: newMarker() })}
          >
            <Braces className="size-3" />
            From a query
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({
  index,
  cells,
  columns,
  onCell,
  onRemove,
}: {
  index: number;
  cells: Cell[];
  columns: Column[];
  onCell: (j: number, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <>
      {cells.map((c, j) => (
        <Input
          key={j}
          aria-label={`Row ${index + 1}, ${columns[j]?.name ?? `column ${j + 1}`}`}
          value={c.value}
          placeholder="NULL"
          onChange={(e) => onCell(j, e.target.value)}
          className={cn(INPUT, "font-mono")}
        />
      ))}
      <Button
        variant="ghost"
        size="iconXs"
        className="text-muted-foreground"
        aria-label={`Remove row ${index + 1}`}
        onClick={onRemove}
      >
        <X className="size-3" />
      </Button>
    </>
  );
}
