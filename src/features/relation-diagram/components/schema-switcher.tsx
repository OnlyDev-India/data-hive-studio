import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { listSchemasIn } from "@/shared/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

/** Postgres: which schema the diagram draws. */
export function SchemaSwitcher({
  conn_id,
  database,
  schema,
  loading = false,
  disabled = false,
  onChange,
}: {
  conn_id: string;
  database?: string;
  schema: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (schema: string) => void;
}) {
  // Keyed by database so a list from the previous one is never shown.
  const [list, setList] = useState<{ db?: string; schemas: string[] } | null>(
    null,
  );
  useEffect(() => {
    let live = true;
    listSchemasIn(conn_id, database).then(
      (s) => live && setList({ db: database, schemas: s }),
      () => live && setList({ db: database, schemas: [] }),
    );
    return () => {
      live = false;
    };
  }, [conn_id, database]);
  const listed = !!list && list.db === database;
  const schemas =
    listed && list.schemas.includes(schema)
      ? list.schemas
      : [schema, ...(listed ? list.schemas : [])];
  const busy = loading || !listed;
  return (
    <Select
      value={schema}
      onValueChange={(v) => v && onChange(String(v))}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label="Schema"
        aria-busy={busy}
        className="h-7 min-w-28"
      >
        <SelectValue />
        {busy && (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none" />
        )}
      </SelectTrigger>
      <SelectContent>
        {schemas.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
