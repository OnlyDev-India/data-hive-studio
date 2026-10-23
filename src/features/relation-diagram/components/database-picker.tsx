import { useEffect, useState } from "react";
import { listDatabases } from "@/shared/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

/** Which database on the connection the diagram draws. Lists only the
 *  current one when the list can't be read. An empty `database` (a MySQL
 *  connection with no default one) shows a prompt to pick. */
export function DatabasePicker({
  conn_id,
  database,
  onChange,
}: {
  conn_id: string;
  database: string;
  onChange: (database: string) => void;
}) {
  const own = database ? [database] : [];
  const [databases, setDatabases] = useState<string[]>(own);
  useEffect(() => {
    let live = true;
    const cur = database ? [database] : [];
    listDatabases(conn_id).then(
      (d) => live && setDatabases(d.includes(database) ? d : [...cur, ...d]),
      () => live && setDatabases(cur),
    );
    return () => {
      live = false;
    };
  }, [conn_id, database]);
  return (
    <Select value={database} onValueChange={(v) => v && onChange(String(v))}>
      <SelectTrigger size="sm" aria-label="Database" className="h-7 min-w-28">
        <SelectValue placeholder="Pick a database" />
      </SelectTrigger>
      <SelectContent>
        {databases.map((d) => (
          <SelectItem key={d} value={d}>
            {d}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
