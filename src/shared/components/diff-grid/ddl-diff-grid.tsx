import { Fragment } from "react";
import { cn } from "@/shared/lib/utils";
import type {
  DdlColumnRow,
  DdlDiffSection,
  DdlNamedRow,
  DdlPropertyRow,
  DdlTriggerRow,
} from "./types";

/** Grid-formatted review for `DdlDiffSection[]` — one small table per entity
 *  category present in `sections` (never an empty one), each row styled with
 *  the same insert/update/delete conventions `RowDiffGrid` uses (an update
 *  renders as a red row directly above a green row). Table rename and
 *  primary key change share one "Table properties" panel since both are at
 *  most one row and always an alter. Always read only: DDL is never
 *  selectable, since excluding half of a drop+create pair would build broken
 *  SQL. */
export function DdlDiffGrid({
  sections,
  documents = false,
}: {
  sections: DdlDiffSection[];
  /** Column rows are document field paths: Path, Types, Optional. */
  documents?: boolean;
}) {
  const properties = sections
    .filter(
      (s): s is { entity: "table" | "primary key"; rows: DdlPropertyRow[] } =>
        s.entity === "table" || s.entity === "primary key",
    )
    .flatMap((s) => s.rows);
  const columns =
    sections.find(
      (s): s is { entity: "column"; rows: DdlColumnRow[] } =>
        s.entity === "column",
    )?.rows ?? [];
  const indexes =
    sections.find(
      (s): s is { entity: "index"; rows: DdlNamedRow[] } =>
        s.entity === "index",
    )?.rows ?? [];
  const foreign_keys =
    sections.find(
      (s): s is { entity: "foreign key"; rows: DdlNamedRow[] } =>
        s.entity === "foreign key",
    )?.rows ?? [];
  const triggers =
    sections.find(
      (s): s is { entity: "trigger"; rows: DdlTriggerRow[] } =>
        s.entity === "trigger",
    )?.rows ?? [];

  return (
    <div className="divide-y">
      {properties.length > 0 && (
        <DdlSection label="Table properties">
          <PropertyTable rows={properties} />
        </DdlSection>
      )}
      {columns.length > 0 && (
        <DdlSection label="Columns">
          <ColumnTable
            rows={columns}
            fields={documents ? FIELD_PATH_FIELDS : DDL_COLUMN_FIELDS}
          />
        </DdlSection>
      )}
      {indexes.length > 0 && (
        <DdlSection label="Indexes">
          <NamedTable rows={indexes} />
        </DdlSection>
      )}
      {foreign_keys.length > 0 && (
        <DdlSection label="Foreign keys">
          <NamedTable rows={foreign_keys} />
        </DdlSection>
      )}
      {triggers.length > 0 && (
        <DdlSection label="Triggers">
          <TriggerRows rows={triggers} />
        </DdlSection>
      )}
    </div>
  );
}

function DdlSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2">
      <div className="text-muted-foreground text-small px-3 pb-1 font-medium">
        {label}
      </div>
      {children}
    </div>
  );
}

function PropertyTable({ rows }: { rows: DdlPropertyRow[] }) {
  return (
    <div className="overflow-x-auto px-3">
      <table className="text-small w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground py-1 pr-3 text-left font-medium">
              Property
            </th>
            <th className="text-muted-foreground py-1 pr-3 text-left font-medium">
              Before
            </th>
            <th className="text-muted-foreground py-1 text-left font-medium">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0">
              <td className="text-muted-foreground py-1.5 pr-3 align-top font-medium whitespace-nowrap">
                {r.label}
              </td>
              <td className="bg-diff-remove text-diff-remove-foreground py-1.5 pr-3 font-mono break-all">
                {r.before ?? ""}
              </td>
              <td className="bg-diff-add text-diff-add-foreground py-1.5 font-mono break-all">
                {r.after ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DDL_COLUMN_FIELDS = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "nullable", label: "Nullable" },
  { key: "default", label: "Default" },
] as const;

const FIELD_PATH_FIELDS = [
  { key: "name", label: "Path" },
  { key: "type", label: "Types" },
  { key: "nullable", label: "Optional" },
] as const;

interface ColumnField {
  key: "name" | "type" | "nullable" | "default";
  label: string;
}

function ColumnTable({
  rows,
  fields,
}: {
  rows: DdlColumnRow[];
  fields: readonly ColumnField[];
}) {
  const cell_cls = "min-w-24 border-b px-2 py-1.5 font-mono break-all";
  const added = "bg-diff-add text-diff-add-foreground";
  const removed = "bg-diff-remove text-diff-remove-foreground";

  const cell = (v: DdlColumnRow["before"], key: ColumnField["key"]) => {
    if (!v) return "";
    if (key === "nullable") return v.nullable ? "yes" : "no";
    return v[key];
  };

  return (
    <div className="overflow-x-auto">
      <table className="text-small w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="w-5" />
            {fields.map((f) => (
              <th
                key={f.key}
                className="text-muted-foreground min-w-24 px-2 py-1.5 text-left font-medium"
              >
                {f.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === "update") {
              return (
                <Fragment key={r.id}>
                  <tr>
                    <td className="text-diff-remove-foreground border-b px-1 py-1.5 select-none">
                      −
                    </td>
                    {fields.map((f) => (
                      <td key={f.key} className={cn(cell_cls, removed)}>
                        {cell(r.before, f.key)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="text-diff-add-foreground border-b px-1 py-1.5 select-none">
                      +
                    </td>
                    {fields.map((f) => (
                      <td key={f.key} className={cn(cell_cls, added)}>
                        {cell(r.after, f.key)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            }
            const is_insert = r.kind === "insert";
            const values = is_insert ? r.after : r.before;
            return (
              <tr key={r.id}>
                <td
                  className={cn(
                    "border-b px-1 py-1.5 select-none",
                    is_insert
                      ? "text-diff-add-foreground"
                      : "text-diff-remove-foreground",
                  )}
                >
                  {is_insert ? "+" : "−"}
                </td>
                {fields.map((f) => (
                  <td
                    key={f.key}
                    className={cn(cell_cls, is_insert ? added : removed)}
                  >
                    {cell(values, f.key)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Index / foreign key rows — each still one opaque definition line, so the
 *  grid is Name + Definition, not fully decomposed fields. */
function NamedTable({ rows }: { rows: DdlNamedRow[] }) {
  const line_cls = "px-2 py-1.5 font-mono break-all";
  const added = "bg-diff-add text-diff-add-foreground";
  const removed = "bg-diff-remove text-diff-remove-foreground";
  return (
    <div className="overflow-x-auto">
      <table className="text-small w-full border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-muted-foreground px-2 py-1.5 text-left font-medium">
              Name
            </th>
            <th className="text-muted-foreground px-2 py-1.5 text-left font-medium">
              Definition
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const is_insert = r.kind === "insert";
            const text = is_insert ? r.after : r.before;
            return (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="text-muted-foreground px-2 py-1.5 align-top font-mono">
                  {r.name}
                </td>
                <td className={cn(line_cls, is_insert ? added : removed)}>
                  {text ?? ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Trigger rows — the full SQL body doesn't fit a normal cell, so each row
 *  renders full width instead (red for the old body, green for the new
 *  one), inside the same section container as the other entity tables. */
function TriggerRows({ rows }: { rows: DdlTriggerRow[] }) {
  return (
    <div className="space-y-1 px-3">
      {rows.map((r) => {
        const is_insert = r.kind === "insert";
        const text = is_insert ? r.after : r.before;
        return (
          <div
            key={r.id}
            className={cn(
              "overflow-hidden rounded border",
              is_insert
                ? "bg-diff-add text-diff-add-foreground"
                : "bg-diff-remove text-diff-remove-foreground",
            )}
          >
            <div className="text-caption flex items-baseline gap-1.5 border-b border-current/20 px-2 py-1 font-medium">
              <span className="select-none">{is_insert ? "+" : "−"}</span>
              <span>{r.name}</span>
            </div>
            <div className="text-small px-2 py-1.5 font-mono break-all whitespace-pre-wrap">
              {text ?? ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}
