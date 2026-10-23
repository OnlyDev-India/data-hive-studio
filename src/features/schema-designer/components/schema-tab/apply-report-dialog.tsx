import { Check, CircleSlash, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import type { SchemaApplyReport, StatementStatus } from "@/shared/api";
import { cn } from "@/shared/lib/utils";

const LABEL: Record<StatementStatus, string> = {
  applied: "Applied",
  failed: "Failed",
  not_run: "Not run",
};

/** Where a MySQL schema apply stopped (spec 0025 AC-19): every statement
 *  as applied, failed with the server's message, or not run. MySQL can't
 *  roll back DDL, so the applied ones stay. */
export function ApplyReportDialog({
  report,
  on_close,
}: {
  report: SchemaApplyReport;
  on_close: () => void;
}) {
  const applied = report.statements.filter(
    (s) => s.status === "applied",
  ).length;
  return (
    <Dialog open onOpenChange={(o) => !o && on_close()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Schema change stopped</DialogTitle>
          <DialogDescription>
            {applied === 0
              ? "The first statement failed, so nothing changed."
              : `${applied} statement${applied === 1 ? "" : "s"} applied before the failure and stay applied. MySQL can't roll them back.`}
          </DialogDescription>
        </DialogHeader>
        <ol className="rounded-control flex max-h-96 flex-col overflow-y-auto border">
          {report.statements.map((s, i) => (
            <li
              key={i}
              className="flex flex-col gap-1 border-b px-3 py-2 last:border-b-0"
            >
              <span
                className={cn(
                  "text-small flex items-center gap-1.5 font-medium",
                  s.status === "applied" && "text-success",
                  s.status === "failed" && "text-destructive",
                  s.status === "not_run" && "text-muted-foreground",
                )}
              >
                {s.status === "applied" ? (
                  <Check className="size-3.5" />
                ) : s.status === "failed" ? (
                  <X className="size-3.5" />
                ) : (
                  <CircleSlash className="size-3.5" />
                )}
                {LABEL[s.status]}
              </span>
              <code className="wrap-break-words text-small whitespace-pre-wrap">
                {s.sql};
              </code>
              {s.message && (
                <span className="text-destructive text-small font-mono">
                  {s.message}
                </span>
              )}
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button onClick={on_close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
