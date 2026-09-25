import type { ColumnInfo, DbKind } from "@/shared/api";
import type { Mapping } from "../lib/mapping";
import type { NewColumn } from "../lib/build-create-sql";
import type { ParsedFile } from "../lib/types";
import { ColumnMapping } from "./column-mapping";
import { NewTableForm } from "./new-table-form";
import { PreviewTable } from "./preview-table";
import { SummaryCards } from "./summary-cards";

interface Props {
  fileName: string;
  parsed: ParsedFile;
  columns: ColumnInfo[];
  mapping: Mapping;
  onMapping: (m: Mapping) => void;
  mappedCount: number;
  db: DbKind | undefined;
  emptyAsText: boolean;
  isNew: boolean;
  newCols: NewColumn[];
  onNewCols: (c: NewColumn[]) => void;
  /** Document stores: fields this import will add to the collection. */
  added?: ColumnInfo[];
  onAdded?: (a: ColumnInfo[]) => void;
}

/** Step 3: match file columns to target columns, with the rows as they will
 *  be written next to it. */
export function MappingStep(p: Props) {
  return (
    <div className="min-w-0 space-y-4">
      <SummaryCards
        items={[
          ["File", p.fileName],
          ["Rows", `${p.parsed.rows.length.toLocaleString()} rows`],
          ["Mapped", `${p.mappedCount} / ${p.parsed.header.length}`],
        ]}
      />
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Panel title={p.isNew ? "New columns" : "Column Mapping"}>
          {p.isNew ? (
            <NewTableForm
              columns={p.newCols}
              onColumns={p.onNewCols}
              db={p.db}
            />
          ) : (
            <ColumnMapping
              columns={p.columns}
              parsed={p.parsed}
              mapping={p.mapping}
              onMapping={p.onMapping}
              db={p.db}
              added={p.added}
              onAdded={p.onAdded}
            />
          )}
        </Panel>
        <Panel title="Preview">
          <PreviewTable
            parsed={p.parsed}
            mapping={p.mapping}
            columns={p.columns}
            db={p.db}
            emptyAsText={p.emptyAsText}
            newCollection={p.isNew}
          />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-accent/40 flex min-w-0 flex-col overflow-hidden rounded-lg border">
      <h3 className="border-b px-3 py-2 text-sm font-medium">{title}</h3>
      <div className="max-h-80 min-h-0 overflow-auto">{children}</div>
    </section>
  );
}
