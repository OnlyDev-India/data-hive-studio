import type { ImportOnError } from "@/shared/api";
import { SummaryCards } from "./summary-cards";

const SELECT = "bg-input/30 h-9 w-full rounded-md border px-2 text-sm";

interface Props {
  targetLabel: string;
  fileName: string;
  rowCount: number;
  mappedCount: number;
  columnCount: number;
  onError: ImportOnError;
  onOnError: (v: ImportOnError) => void;
  /** A document store with no transactions: Roll back is not atomic. */
  looseRollback: boolean;
}

/** Step 4: a last look, and what to do with rows that fail. */
export function ReviewStep(p: Props) {
  return (
    <div className="min-w-0 space-y-4">
      <SummaryCards
        cols={2}
        items={[
          ["Target table", p.targetLabel],
          ["Source file", p.fileName],
          ["Rows", `${p.rowCount.toLocaleString()} rows`],
          ["Mapped", `${p.mappedCount} / ${p.columnCount}`],
        ]}
      />
      <label className="block max-w-sm space-y-1.5">
        <span className="text-sm font-medium">Bad rows</span>
        <select
          className={SELECT}
          value={p.onError}
          onChange={(e) => p.onOnError(e.target.value as ImportOnError)}
        >
          <option value="rollback">Roll back everything</option>
          <option value="skip">Skip them, load the rest</option>
        </select>
      </label>
      {p.looseRollback && p.onError === "rollback" && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          This server has no transactions, so Roll back is not atomic. If a
          document fails, the ones before it stay in the collection. The result
          tells you how many landed.
        </p>
      )}
    </div>
  );
}
