import { Code } from "lucide-react";
import {
  FormLabel,
  Pick,
  Rows,
  Text,
} from "@/shared/components/builder-canvas";
import { Button } from "@/shared/components/ui/button";
import { useTables } from "../../lib/card-actions";
import type { Column } from "../../lib/columns";
import { JOIN_TYPES, type JoinForm, type OnPair } from "../../lib/forms/tables";
import { tableIdent } from "../../lib/joins";
import type { Dialect } from "../../lib/sql-text";
import { TablePicker } from "../table-picker";
import { isMarker } from "../../lib/markers";
import { ColumnInput, subSource, TableButton, tableName } from "./inputs";

export function JoinBody({
  id,
  join,
  columns,
  dialect,
  onJoin,
  newMarker,
}: {
  id: string;
  join: JoinForm;
  columns: Column[];
  dialect: Dialect;
  onJoin: (j: JoinForm) => void;
  newMarker: () => number;
}) {
  const { home, suggestions, aliasFor } = useTables();
  const on = join.on;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="w-28 shrink-0">
          <Pick
            label="Join type"
            value={join.type}
            options={JOIN_TYPES.map((t) => [t, t.replace(" JOIN", "")])}
            onValue={(type) =>
              onJoin({ ...join, type: type as JoinForm["type"] })
            }
          />
        </div>
        <TablePicker
          suggestions={suggestions(id)}
          onSubquery={
            join.table && isMarker(join.table.name)
              ? undefined
              : () =>
                  onJoin({
                    ...join,
                    table: subSource(newMarker(), join.table?.alias ?? null),
                  })
          }
          trigger={
            <TableButton>
              {join.table ? tableName(join.table) : "Pick a table"}
            </TableButton>
          }
          onPick={(t, s) => {
            const alias = aliasFor(id, t.name);
            onJoin({
              ...join,
              table: {
                schema: null,
                name: tableIdent(t, home, dialect),
                alias,
              },
              on: s ? { mode: "pairs", pairs: s.on } : join.on,
            });
          }}
        />
        <div className="w-24 shrink-0">
          <Text
            label="Alias"
            value={join.table?.alias ?? ""}
            placeholder="alias"
            onValue={(alias) =>
              join.table &&
              onJoin({
                ...join,
                table: { ...join.table, alias: alias.trim() || null },
              })
            }
            mono
          />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <FormLabel>ON</FormLabel>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground ml-auto h-6 px-2"
          onClick={() =>
            onJoin({
              ...join,
              on:
                on.mode === "pairs"
                  ? {
                      mode: "text",
                      text: on.pairs
                        .filter((p) => p.left && p.right)
                        .map((p) => `${p.left} = ${p.right}`)
                        .join(" AND "),
                    }
                  : { mode: "pairs", pairs: [] },
            })
          }
        >
          <Code className="size-3" />
          {on.mode === "pairs" ? "Write it as text" : "Use column pairs"}
        </Button>
      </div>
      {on.mode === "pairs" ? (
        <Rows<OnPair>
          rows={on.pairs}
          add="Add column pair"
          blank={{ left: "", right: "" }}
          onRows={(pairs) => onJoin({ ...join, on: { mode: "pairs", pairs } })}
          cols="grid-cols-[1fr_auto_1fr_1.5rem]"
          render={(r, set) => (
            <>
              <ColumnInput
                columns={columns}
                value={r.left}
                onValue={(left) => set({ ...r, left })}
              />
              <span className="text-muted-foreground text-small">=</span>
              <ColumnInput
                columns={columns}
                value={r.right}
                onValue={(right) => set({ ...r, right })}
              />
            </>
          )}
        />
      ) : (
        <Text
          label="ON condition"
          value={on.text}
          placeholder="a.x = b.y AND b.active"
          onValue={(text) => onJoin({ ...join, on: { mode: "text", text } })}
          mono
        />
      )}
    </div>
  );
}
