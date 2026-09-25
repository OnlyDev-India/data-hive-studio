import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { tableSchema, type ColumnInfo } from "@/shared/api";
import { newColumn, splitType, type ColumnDef } from "./model";

interface Props {
  connId: string;
  tables: string[];
  database?: string;
  schema?: string;
  onCopy: (cols: ColumnDef[]) => void;
  onClose: () => void;
}

function fromInfo(c: ColumnInfo): ColumnDef {
  return {
    ...newColumn(),
    ...splitType(c.data_type),
    name: c.name,
    primary_key: c.primary_key,
    not_null: c.not_null,
    default: c.default ?? "",
  };
}

/** Pick another table and some of its columns to start from. */
export function CopyFieldsDialog({
  connId,
  tables,
  database,
  schema,
  onCopy,
  onClose,
}: Props) {
  const [table, setTable] = useState<string | null>(null);
  const [cols, setCols] = useState<ColumnInfo[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!table) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- claims the loading flag before the fetch starts
    setLoading(true);
    setError(null);
    tableSchema(connId, table, database, schema)
      .then((s) => {
        if (!live) return;
        setCols(s.columns);
        setPicked(new Set(s.columns.map((c) => c.name)));
      })
      .catch((e: unknown) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [connId, table, database, schema]);

  const toggle = (name: string, on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(name);
      else n.delete(name);
      return n;
    });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy fields from another table</DialogTitle>
          <DialogDescription>
            The chosen columns are added to the end of this table.
          </DialogDescription>
        </DialogHeader>
        <Select value={table} onValueChange={(v) => v && setTable(v)}>
          <SelectTrigger className="w-full" aria-label="Table to copy from">
            <SelectValue placeholder="Pick a table" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {tables.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {loading && <Loader2 className="size-4 animate-spin" />}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {cols.length > 0 && (
          <div className="max-h-72 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="bg-muted sticky top-0 w-10 border-b px-3 py-2">
                    <Checkbox
                      checked={picked.size === cols.length}
                      indeterminate={
                        picked.size > 0 && picked.size < cols.length
                      }
                      aria-label="Select all fields"
                      onCheckedChange={(v) =>
                        setPicked(
                          v === true
                            ? new Set(cols.map((c) => c.name))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="bg-muted sticky top-0 border-b px-2 py-2 text-left font-medium">
                    Field
                  </th>
                  <th className="bg-muted sticky top-0 border-b px-2 py-2 text-left font-medium">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody>
                {cols.map((c) => (
                  <tr key={c.name}>
                    <td className="border-b px-3 py-1.5">
                      <Checkbox
                        checked={picked.has(c.name)}
                        aria-label={`Copy ${c.name}`}
                        onCheckedChange={(v) => toggle(c.name, v === true)}
                      />
                    </td>
                    <td className="border-b px-2 py-1.5 font-mono">{c.name}</td>
                    <td className="text-muted-foreground border-b px-2 py-1.5 text-xs">
                      {c.data_type}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={picked.size === 0}
            onClick={() => {
              onCopy(cols.filter((c) => picked.has(c.name)).map(fromInfo));
              onClose();
            }}
          >
            Copy {picked.size} field{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
