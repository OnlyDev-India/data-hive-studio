import { FormLabel } from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import type { Column } from "../../lib/columns";
import type { InsertForm } from "../../lib/forms/writes";
import { quoteIdent, unquote, type Dialect } from "../../lib/sql-text";
import { TableRow } from "./inputs";

/** The INSERT card: the table, and which columns the rows fill (none
 *  picked means every column, in table order). */
export function InsertBody({
  f,
  columns,
  dialect,
  onF,
}: {
  f: InsertForm;
  /** The table's own columns. */
  columns: Column[];
  dialect: Dialect;
  onF: (f: InsertForm) => void;
}) {
  const listed = new Set(f.columns.map(unquote));
  // Listed columns the catalog doesn't know yet still show, and stay.
  const unknown = f.columns.filter(
    (c) => !columns.some((x) => x.name === unquote(c)),
  );
  const toggle = (name: string) => {
    const on = columns
      .map((c) => c.name)
      .filter((n) => (n === name ? !listed.has(n) : listed.has(n)));
    onF({
      ...f,
      columns: [...on.map((n) => quoteIdent(n, dialect)), ...unknown],
    });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <TableRow
        table={f.table}
        dialect={dialect}
        // Postgres takes an alias here (AS), SQLite doesn't.
        alias={dialect === "postgresql"}
        onTable={(table) =>
          onF({
            table,
            columns: f.table?.name === table.name ? f.columns : [],
          })
        }
      />
      <div className="flex items-center gap-1.5">
        <FormLabel>Columns</FormLabel>
        {f.columns.length === 0 ? (
          <span className="text-muted-foreground text-small">
            all, in table order
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground ml-auto h-6 px-2"
            onClick={() => onF({ ...f, columns: [] })}
          >
            Use all columns
          </Button>
        )}
      </div>
      {columns.length + unknown.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {columns.map((c) => {
            const on = listed.has(c.name);
            return (
              <Button
                key={c.name}
                variant={on ? "secondary" : "outline"}
                size="sm"
                aria-pressed={on}
                title={c.type ?? undefined}
                className="h-6 px-2 font-mono"
                onClick={() => toggle(c.name)}
              >
                {c.name}
              </Button>
            );
          })}
          {unknown.map((c) => (
            <Button
              key={c}
              variant="secondary"
              size="sm"
              aria-pressed
              className="h-6 px-2 font-mono"
              onClick={() =>
                onF({ ...f, columns: f.columns.filter((x) => x !== c) })
              }
            >
              {c}
            </Button>
          ))}
        </div>
      ) : (
        f.table && (
          <p className="text-muted-foreground text-small px-1">
            The columns show once the table is read.
          </p>
        )
      )}
    </div>
  );
}
