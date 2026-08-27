import { useState } from "react";
import {
  ArrowLeft,
  Braces,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Sheet,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { executeOpStream, type QueryOp } from "@/shared/api";
import { useStudioStore, type GridBridge } from "@/shared/store";
import { cn } from "@/shared/lib/utils";
import { saveExport, type ExportFormat } from "../lib/export";

const EXPORT_ITEMS: {
  format: ExportFormat;
  label: string;
  icon: typeof FileText;
}[] = [
  { format: "excel", label: "Excel (.xlsx)", icon: Sheet },
  { format: "csv", label: "CSV", icon: FileSpreadsheet },
  { format: "json", label: "JSON", icon: Braces },
  { format: "sql", label: "SQL INSERTs", icon: TableIcon },
  { format: "markdown", label: "Markdown", icon: FileText },
];

/** What the export covers: every row matching the grid's current filters and
 *  sort, or literally the whole table. */
type ExportScope = "filtered" | "table";

/**
 * Two-step export dropdown: the first view picks the scope (filtered data vs
 * whole table); choosing one slides the panel left to reveal the format list,
 * with a back button to return. Both scopes stream all rows fresh from the
 * database — neither is limited to the loaded page. Outcome is reported
 * through the notification center.
 */
export function ExportMenu({
  bridge,
  conn_id,
}: {
  bridge: GridBridge;
  conn_id: string;
}) {
  const [scope, setScope] = useState<ExportScope>("filtered");
  const [step, setStep] = useState<"scope" | "format">("scope");
  const [exporting, setExporting] = useState(false);
  const pushNotification = useStudioStore((s) => s.pushNotification);

  const choose_scope = (s: ExportScope) => {
    if (exporting) return;
    setScope(s);
    setStep("format");
  };

  const do_export = async (format: ExportFormat) => {
    if (exporting) return;
    const base = bridge.get_export();
    if (!base) return;
    setExporting(true);
    try {
      // Stream all rows fresh from the database (no limit / offset).
      let op: QueryOp;
      let has_filters = false;
      if (scope === "filtered") {
        const sel = bridge.get_filtered_op();
        has_filters =
          (sel.filters?.length ?? 0) > 0 || Boolean(sel.custom_where);
        op = sel;
      } else {
        op = { kind: "select", table: base.table };
      }
      const acc: (string | null)[][] = [];
      const meta = await executeOpStream(conn_id, op, (chunk) => {
        acc.push(...chunk.rows);
      });
      const payload = {
        ...base,
        columns: meta.columns.length > 0 ? meta.columns : base.columns,
        rows: acc,
      };
      await saveExport(
        payload,
        format,
        has_filters ? `${payload.table || "result"}-filtered` : undefined,
      );
      pushNotification({
        kind: "success",
        title: `Exported ${
          EXPORT_ITEMS.find((x) => x.format === format)?.label ?? format
        }`,
        detail: `${payload.rows.length} rows · ${
          scope === "filtered" ? "filtered data" : "whole table"
        }`,
      });
    } catch (e) {
      console.error("export failed", e);
      pushNotification({
        kind: "error",
        title: "Export failed",
        detail: String(e),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setStep("scope");
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            disabled={exporting}
            aria-label="Export rows"
            title={exporting ? "Preparing export…" : "Export rows"}
          >
            {exporting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60 overflow-hidden p-0">
        {/* Sliding track: scope panel | format panel. */}
        <div
          className={cn(
            "flex w-[200%] transition-transform duration-200 ease-out",
            { "translate-x-0": step === "scope" },
            { "-translate-x-1/2": step === "format" },
          )}
        >
          {/* Step 1 — choose what to export. */}
          <div className={"w-1/2 shrink-0 p-1"}>
            <div className="px-2 py-1.5 text-sm font-medium">Export</div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => choose_scope("filtered")}
            >
              <Filter className="text-muted-foreground size-3.5" />
              Filtered data ({bridge.total})
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => choose_scope("table")}
            >
              <TableIcon className="text-muted-foreground size-3.5" />
              Whole table
            </DropdownMenuItem>
          </div>
          {/* Step 2 — choose the format. */}
          <div
            className={cn(
              "w-1/2 shrink-0 p-1",
              step === "format" ? "visible" : "hidden",
            )}
          >
            <div className="flex items-center gap-1 px-1 py-1">
              <Button
                variant="ghost"
                size="iconXs"
                className="size-6"
                aria-label="Back"
                title="Back"
                disabled={exporting}
                onClick={() => setStep("scope")}
              >
                <ArrowLeft className="size-3.5" />
              </Button>
              <span className="truncate text-sm font-medium">
                {scope === "filtered"
                  ? `Filtered data (${bridge.total})`
                  : "Whole table"}
              </span>
            </div>
            <DropdownMenuSeparator />
            {EXPORT_ITEMS.map(({ format, label, icon: Icon }) => (
              <DropdownMenuItem
                key={format}
                disabled={exporting}
                onClick={() => void do_export(format)}
              >
                <Icon className="text-muted-foreground size-3.5" />
                {label}
              </DropdownMenuItem>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
