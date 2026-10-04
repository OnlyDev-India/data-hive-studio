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
 *  current one when the list can't be read. */
export function DatabasePicker({
  conn_id,
  database,
  onChange,
}: {
  conn_id: string;
  database: string;
  onChange: (database: string) => void;
}) {
  const [databases, setDatabases] = useState<string[]>([database]);
  useEffect(() => {
    let live = true;
    listDatabases(conn_id).then(
      (d) => live && setDatabases(d.includes(database) ? d : [database, ...d]),
      () => live && setDatabases([database]),
    );
    return () => {
      live = false;
    };
  }, [conn_id, database]);
  return (
    <Select value={database} onValueChange={(v) => v && onChange(String(v))}>
      <SelectTrigger size="sm" aria-label="Database" className="h-7 min-w-28">
        <SelectValue />
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
