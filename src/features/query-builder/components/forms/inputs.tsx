import { useId, type ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { INPUT, Text } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { useTables } from "../../lib/card-actions";
import type { Column } from "../../lib/columns";
import { tableIdent } from "../../lib/joins";
import { isMarker, markerName } from "../../lib/markers";
import type { Dialect, TableRef } from "../../lib/sql-text";
import { TablePicker } from "../table-picker";

/** A column box offering the card's columns. */
export function ColumnInput({
  columns,
  value,
  onValue,
  placeholder = "column",
}: {
  columns: Column[];
  value: string;
  onValue: (v: string) => void;
  placeholder?: string;
}) {
  const list = useId();
  return (
    <>
      <Input
        aria-label={placeholder}
        value={value}
        placeholder={placeholder}
        list={list}
        onChange={(e) => onValue(e.target.value)}
        className={cn(INPUT, "font-mono")}
      />
      <datalist id={list}>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.type ?? ""}
          </option>
        ))}
      </datalist>
    </>
  );
}

export function TableButton({
  children,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      variant="outline"
      size="sm"
      className="nodrag h-6 min-w-0 flex-1 justify-between px-2 font-mono"
    >
      <span className="truncate">{children}</span>
      <ChevronDown className="text-muted-foreground size-3 shrink-0" />
    </Button>
  );
}

export const tableName = (t: TableRef) =>
  isMarker(t.name) ? "Subquery" : t.schema ? `${t.schema}.${t.name}` : t.name;

/** A subquery source with a new marker, aliased `sub<n>` unless it has one. */
export const subSource = (n: number, alias: string | null): TableRef => ({
  schema: null,
  name: markerName(n),
  alias: alias ?? `sub${n}`,
});

/** A table picker with an alias box: FROM, USING, and the UPDATE, DELETE
 *  and INSERT targets. */
export function TableRow({
  table,
  dialect,
  onTable,
  alias = true,
  newMarker,
  autoOpen,
  onOpened,
}: {
  table: TableRef | null;
  dialect: Dialect;
  onTable: (t: TableRef) => void;
  /** Off where the engine takes no alias (an SQLite INSERT). */
  alias?: boolean;
  /** Offers a subquery source, given where its marker comes from. */
  newMarker?: () => number;
  /** The picker opens as the row appears. */
  autoOpen?: boolean;
  onOpened?: () => void;
}) {
  const { home } = useTables();
  const sub = table && isMarker(table.name);
  return (
    <div className="flex items-center gap-1.5">
      <TablePicker
        defaultOpen={autoOpen}
        onClosed={onOpened}
        onSubquery={
          newMarker && !sub
            ? () => onTable(subSource(newMarker(), table?.alias ?? null))
            : undefined
        }
        trigger={
          <TableButton>{table ? tableName(table) : "Pick a table"}</TableButton>
        }
        onPick={(t) =>
          onTable({
            schema: null,
            name: tableIdent(t, home, dialect),
            alias: alias ? (table?.alias ?? null) : null,
          })
        }
      />
      {alias && (
        <div className="w-28">
          <Text
            label="Alias"
            value={table?.alias ?? ""}
            placeholder="alias"
            onValue={(a) =>
              table && onTable({ ...table, alias: a.trim() || null })
            }
            mono
          />
        </div>
      )}
    </div>
  );
}
