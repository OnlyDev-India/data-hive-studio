import { ChevronDown } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import type { ColDraft, MysqlColAttrs } from "@/shared/schema-drafts/drafts";
import {
  MYSQL_COLUMN_TYPES,
  MYSQL_NUMERIC_TYPES,
  MYSQL_ON_UPDATE_TYPES,
} from "../new-table/mysql-model";
import { EditableText } from "./editable-text";

/** What picking a base type from the list writes into the type text. */
const STARTER: Record<string, string> = {
  VARCHAR: "varchar(255)",
  CHAR: "char(1)",
  BINARY: "binary(16)",
  VARBINARY: "varbinary(255)",
  DECIMAL: "decimal(10,2)",
  BIT: "bit(1)",
  ENUM: "enum('a','b')",
  SET: "set('a','b')",
};

/** The base type of a full MySQL type text: `int unsigned` is `INT`. */
const base_of = (type: string) =>
  (/^\s*([a-z]+)/i.exec(type)?.[1] ?? "").toUpperCase();

/** A MySQL column's type: the full text as the server writes it
 *  (`int unsigned`, `enum('a','b')`), editable, with the type list to start
 *  from (spec 0025 AC-18). */
export function MysqlTypeCell({
  c,
  disabled,
  on_update,
}: {
  c: ColDraft;
  disabled: boolean;
  on_update: (id: string, patch: Partial<ColDraft>) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <EditableText
        value={c.data_type}
        placeholder="type"
        ariaLabel="Column type"
        className="font-mono"
        disabled={disabled}
        on_commit={(v) => on_update(c.id, { data_type: v.trim() })}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="iconXs"
              disabled={disabled}
              aria-label="Pick a MySQL type"
              title="Pick a MySQL type"
            >
              <ChevronDown className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          {MYSQL_COLUMN_TYPES.map((t) => (
            <DropdownMenuItem
              key={t}
              className="font-mono"
              onClick={() =>
                on_update(c.id, { data_type: STARTER[t] ?? t.toLowerCase() })
              }
            >
              {t}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Unsigned, Auto increment and On update for one MySQL column. Unsigned
 *  is part of the type text, so it edits that. */
export function MysqlAttrCells({
  c,
  disabled,
  on_update,
}: {
  c: ColDraft;
  disabled: boolean;
  on_update: (id: string, patch: Partial<ColDraft>) => void;
}) {
  const now: MysqlColAttrs = c.mysql?.now ?? {
    auto_increment: false,
    on_update: false,
    comment: "",
  };
  const set = (patch: Partial<MysqlColAttrs>) =>
    on_update(c.id, {
      mysql: { ...c.mysql, now: { ...now, ...patch } },
    });
  const base = base_of(c.data_type);
  const unsigned = /\bunsigned\b/i.test(c.data_type);
  const off = disabled || c.dropped;
  return (
    <div className="text-small flex items-center gap-2">
      <label className="flex items-center gap-1" title="UNSIGNED">
        <Checkbox
          checked={unsigned}
          disabled={off || !MYSQL_NUMERIC_TYPES.has(base)}
          aria-label="Unsigned"
          onCheckedChange={(v) =>
            on_update(c.id, {
              data_type:
                v === true
                  ? `${c.data_type.trim()} unsigned`
                  : c.data_type.replace(/\s*\bunsigned\b/i, "").trim(),
            })
          }
        />
        Unsigned
      </label>
      <label className="flex items-center gap-1" title="AUTO_INCREMENT">
        <Checkbox
          checked={now.auto_increment}
          disabled={off}
          aria-label="Auto increment"
          onCheckedChange={(v) => set({ auto_increment: v === true })}
        />
        Auto
      </label>
      <label
        className="flex items-center gap-1"
        title="ON UPDATE CURRENT_TIMESTAMP"
      >
        <Checkbox
          checked={now.on_update}
          disabled={off || !MYSQL_ON_UPDATE_TYPES.has(base)}
          aria-label="On update, set the current time"
          onCheckedChange={(v) => set({ on_update: v === true })}
        />
        On update
      </label>
    </div>
  );
}

/** The column comment, editable. */
export function MysqlCommentCell({
  c,
  disabled,
  on_update,
}: {
  c: ColDraft;
  disabled: boolean;
  on_update: (id: string, patch: Partial<ColDraft>) => void;
}) {
  const now = c.mysql?.now ?? {
    auto_increment: false,
    on_update: false,
    comment: "",
  };
  if (c.dropped)
    return (
      <span className="text-muted-foreground text-small truncate line-through">
        {now.comment}
      </span>
    );
  return (
    <EditableText
      value={now.comment}
      placeholder="no comment"
      ariaLabel="Column comment"
      className="text-small"
      disabled={disabled}
      on_commit={(v) =>
        on_update(c.id, { mysql: { ...c.mysql, now: { ...now, comment: v } } })
      }
    />
  );
}
