import { Button } from "@/shared/components/ui";
import { failureText } from "../lib/failed-csv";
import type { Outcome } from "../lib/prepare";

const SHOWN = 1000;

interface Props {
  outcome: Outcome;
  onSaveFailed: () => void;
  saving: boolean;
}

function headline(o: Outcome): string {
  if (o.cancelled) {
    return o.committed
      ? `Cancelled. ${o.inserted.toLocaleString()} document${o.inserted === 1 ? "" : "s"} had already been written and stayed.`
      : "Cancelled. Nothing was written.";
  }
  if (o.dryRun) {
    const would = `${o.inserted.toLocaleString()} row${o.inserted === 1 ? "" : "s"} would load`;
    return o.failedTotal > 0
      ? `Check done, nothing was written. ${would}, ${o.failedTotal.toLocaleString()} would fail.`
      : `Check passed, nothing was written. ${would}.`;
  }
  if (
    o.committed &&
    !o.atomic &&
    o.onError === "rollback" &&
    o.failedTotal > 0
  ) {
    return `Loaded ${o.inserted.toLocaleString()} before a failure, and ${o.failedTotal.toLocaleString()} failed. This server cannot roll back, so what loaded stayed in the collection.`;
  }
  if (o.committed) {
    return `Loaded ${o.inserted.toLocaleString()} row${o.inserted === 1 ? "" : "s"}.${
      o.failedTotal > 0 ? ` ${o.failedTotal.toLocaleString()} skipped.` : ""
    }`;
  }
  return `Nothing was written. ${o.failedTotal.toLocaleString()} row${o.failedTotal === 1 ? "" : "s"} failed.`;
}

/** The outcome, then the failures (first 1000 and the total) with a way to
 *  save every reported failed row as CSV. */
export function ResultView({ outcome, onSaveFailed, saving }: Props) {
  const list = outcome.failures.slice(0, SHOWN);
  return (
    <div className="space-y-2 text-sm">
      <p>{headline(outcome)}</p>
      {outcome.failedTotal > 0 && (
        <>
          <ul className="bg-muted/40 max-h-52 overflow-y-auto rounded-md border p-2 text-xs">
            {list.map((f) => (
              <li key={`${f.rowIndex}-${f.column ?? ""}`}>
                Row {f.sourceRow}: {failureText(f)}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              Showing {list.length.toLocaleString()} of{" "}
              {outcome.failedTotal.toLocaleString()} failed rows
              {outcome.truncated
                ? " (the list stopped at the first 10,000)"
                : ""}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={onSaveFailed}
            >
              Save failed rows as CSV
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
