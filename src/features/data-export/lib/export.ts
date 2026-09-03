import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@/shared/api/client";
import type { ExportPayload } from "@/shared/api";

/** Supported export formats for grid results. */
export type ExportFormat = "csv" | "json" | "sql" | "markdown" | "excel";

const FORMAT_META: Record<ExportFormat, { label: string; ext: string }> = {
  csv: { label: "CSV file", ext: "csv" },
  json: { label: "JSON file", ext: "json" },
  sql: { label: "SQL file", ext: "sql" },
  markdown: { label: "Markdown file", ext: "md" },
  excel: { label: "Excel workbook", ext: "xlsx" },
};

/** Convert a raw cell string into a JSON-friendly value (mirrors the JSON viewer). */
function jsonValue(v: string | null, sqlType: string | undefined): unknown {
  if (v === null) return null;
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool")) return v === "1" || v.toLowerCase() === "true";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v.trim()) return n;
  }
  return v;
}

/** Render a cell value as a SQL literal for an INSERT statement. */
function sqlLiteral(v: string | null, sqlType: string | undefined): string {
  if (v === null) return "NULL";
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool"))
    return v === "1" || v.toLowerCase() === "true" ? "1" : "0";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n)) return v;
  }
  return `'${v.replaceAll("'", "''")}'`;
}

function csvField(v: string | null): string {
  if (v === null) return "";
  // Quote when the value contains a separator, quote or newline.
  if (/[",\n\r]/.test(v)) return `"${v.replaceAll('"', '""')}"`;
  return v;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Serialize the payload in the requested format. */
export function buildExport(p: ExportPayload, format: ExportFormat): string {
  if (format === "csv") {
    const lines = [p.columns.map(csvField).join(",")];
    for (const row of p.rows) lines.push(row.map(csvField).join(","));
    return lines.join("\n");
  }
  if (format === "json") {
    const objs = p.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      p.columns.forEach((col, i) => {
        obj[col] = jsonValue(row[i] ?? null, p.types?.[col]);
      });
      return obj;
    });
    return JSON.stringify(objs, null, 2);
  }
  if (format === "sql") {
    const table = quoteIdent(p.table.trim() || "result");
    const cols = p.columns.map(quoteIdent).join(", ");
    return p.rows
      .map(
        (row) =>
          `INSERT INTO ${table} (${cols}) VALUES (${row
            .map((v, i) => sqlLiteral(v ?? null, p.types?.[p.columns[i]]))
            .join(", ")});`,
      )
      .join("\n");
  }
  // markdown
  const header = `| ${p.columns.join(" | ")} |`;
  const sep = `| ${p.columns.map(() => "---").join(" | ")} |`;
  const body = p.rows.map(
    (row) =>
      `| ${row
        .map((v) => (v ?? "").replaceAll("|", "\\|").replaceAll("\n", " "))
        .join(" | ")} |`,
  );
  return [header, sep, ...body].join("\n");
}

/** Cell value for a spreadsheet: booleans/numbers become native cells,
 *  NULL becomes an empty cell, everything else stays text. */
function sheetValue(
  v: string | null,
  sqlType: string | undefined,
): string | number | boolean | null {
  if (v === null) return null;
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool")) return v === "1" || v.toLowerCase() === "true";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v.trim()) return n;
  }
  return v;
}

/** Build the export as bytes — text formats are UTF-8, Excel is a real
 *  .xlsx workbook (SheetJS is loaded lazily to keep startup light). */
export async function buildExportBytes(
  p: ExportPayload,
  format: ExportFormat,
): Promise<Uint8Array> {
  if (format !== "excel") {
    return new TextEncoder().encode(buildExport(p, format));
  }
  const XLSX = await import("xlsx");
  const aoa: (string | number | boolean | null)[][] = [
    p.columns,
    ...p.rows.map((row) =>
      row.map((v, i) => sheetValue(v ?? null, p.types?.[p.columns[i]])),
    ),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Rough auto-fit: widest of header / first 200 rows, capped at 60 chars.
  ws["!cols"] = p.columns.map((col, ci) => {
    let w = col.length + 2;
    for (const r of p.rows.slice(0, 200)) {
      const len = String(r[ci] ?? "").length + 2;
      if (len > w) w = len;
    }
    return { wch: Math.min(60, w) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    (p.table.trim() || "result").slice(0, 31),
  );
  return new Uint8Array(
    XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer,
  );
}

/** Show the native save dialog and write the export. Returns the chosen path,
 *  or null when the user cancels. `nameHint` overrides the default file name
 *  (without extension). */
export async function saveExport(
  p: ExportPayload,
  format: ExportFormat,
  nameHint?: string,
): Promise<string | null> {
  const meta = FORMAT_META[format];
  const base = nameHint?.trim() || p.table.trim() || "result";
  const path = await save({
    defaultPath: `${base}.${meta.ext}`,
    filters: [{ name: meta.label, extensions: [meta.ext] }],
  });
  if (!path || Array.isArray(path)) return null;
  await writeFile(path, Array.from(await buildExportBytes(p, format)));
  return path;
}
