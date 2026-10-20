import { useEffect, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { mysqlCharsets, type MysqlCharsets } from "@/shared/api";

export interface MysqlTableOptions {
  charset: string;
  collation: string;
  comment: string;
}

export const EMPTY_TABLE_OPTIONS: MysqlTableOptions = {
  charset: "",
  collation: "",
  comment: "",
};

/** A MySQL table's charset, collation and comment (spec 0025 AC-18). For
 *  a new table, empty pickers take the target database's defaults, named in
 *  the placeholder, and the engine is the server's default. For an existing
 *  one (`engine` given) they start at its own values. The engine is read
 *  only either way. */
export function MysqlTableOptionsRow({
  conn_id,
  database,
  value,
  on_change,
  engine,
  disabled = false,
}: {
  conn_id: string;
  /** An existing table's engine, shown instead of the server default; an
   *  existing table also has no "database default" choice. */
  engine?: string;
  disabled?: boolean;
  /** The target database, whose defaults apply; omitted = the server's. */
  database?: string;
  value: MysqlTableOptions;
  on_change: (v: MysqlTableOptions) => void;
}) {
  const [lists, setLists] = useState<MysqlCharsets | null>(null);
  useEffect(() => {
    let cancelled = false;
    mysqlCharsets(conn_id, database).then(
      (l) => !cancelled && setLists(l),
      () => !cancelled && setLists(null),
    );
    return () => {
      cancelled = true;
    };
  }, [conn_id, database]);
  const collations = (lists?.collations ?? [])
    .filter(
      (c) => c.charset === (value.charset || lists?.default_charset || ""),
    )
    .map((c) => c.name);
  const picker = (
    label: string,
    current: string,
    options: string[],
    none: string,
    set: (v: string) => void,
    allow_none: boolean,
  ) => (
    <div className="grid gap-2">
      <label className="text-body font-medium">{label}</label>
      <Select
        value={current}
        disabled={disabled}
        onValueChange={(v) => set(v ?? "")}
      >
        <SelectTrigger className="w-48" size="sm" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {allow_none && <SelectItem value="">{none}</SelectItem>}
            {(current && !options.includes(current)
              ? [current, ...options]
              : options
            ).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-3">
      {picker(
        "Charset",
        value.charset,
        (lists?.charsets ?? []).map((c) => c.name),
        `Database default${lists?.default_charset ? ` (${lists.default_charset})` : ""}`,
        (charset) => on_change({ ...value, charset, collation: "" }),
        engine === undefined,
      )}
      {picker(
        "Collation",
        value.collation,
        collations,
        value.charset
          ? `Default for ${value.charset}`
          : `Database default${lists?.default_collation ? ` (${lists.default_collation})` : ""}`,
        (collation) => on_change({ ...value, collation }),
        true,
      )}
      <div className="grid min-w-48 flex-1 gap-2">
        <label className="text-body font-medium">Comment</label>
        <Input
          placeholder="what the table holds"
          aria-label="Table comment"
          disabled={disabled}
          value={value.comment}
          onChange={(e) => on_change({ ...value, comment: e.target.value })}
        />
      </div>
      <div className="grid gap-2">
        <label className="text-body font-medium">Engine</label>
        <Input
          readOnly
          disabled
          className="w-28"
          aria-label="Engine"
          title={
            engine === undefined
              ? "New tables use the server's default engine"
              : "The table's engine"
          }
          value={engine ?? lists?.default_engine ?? ""}
        />
      </div>
    </div>
  );
}
