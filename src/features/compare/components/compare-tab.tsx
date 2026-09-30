import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  CircleCheck,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import {
  applySchemaOps,
  mongoFieldTree,
  tableSchema,
  type ConnectionInfo,
  type FieldShape,
  type TableRef,
} from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { DdlDiffGrid } from "@/shared/components/diff-grid";
import { ApplyChangesDialog } from "@/shared/components/apply-changes-dialog";
import {
  EMPTY_COMPARE_SETUP,
  stableConnKey,
  useStudioStore,
  type CompareSetup,
} from "@/shared/store";
import { drafts_toward, structure_diff } from "../lib/drafts-toward";
import { mongo_structure_diff } from "../lib/mongo-structure";
import {
  diff_counts,
  engine_of,
  ref_engine,
  ref_name,
  resolve_ref,
  type Engine,
} from "../lib/refs";
import { useAsync } from "../lib/use-async";
import {
  mongo_structure_sync,
  sql_structure_sync,
  type StructureSync,
} from "../lib/sync-structure";
import { DataSection } from "./data-section";
import { SidePicker } from "./side-picker";

/** Two tables side by side: pick each side, see how the right's structure
 *  differs from the left's. `on_reopen` reconnects a side's closed
 *  connection by its stable key, resolving to the new connection or to a
 *  message saying why it couldn't. */
export function CompareTab({
  tab_key,
  active,
  on_reopen,
}: {
  conn_id: string;
  tab_key: string;
  /** The tab on screen in its pane; only it answers the run shortcut. */
  active: boolean;
  on_reopen: (conn_key: string) => Promise<ConnectionInfo | string>;
}) {
  const setup =
    useStudioStore((s) => s.compareTabs[tab_key]) ?? EMPTY_COMPARE_SETUP;
  const setCompareSetup = useStudioStore((s) => s.setCompareSetup);
  const open = useStudioStore((s) => s.open);

  const left_conn = resolve_ref(setup.left, open);
  const right_conn = resolve_ref(setup.right, open);

  // Any engine while both sides are empty; otherwise the other side's.
  const candidates = (other: TableRef | null) => {
    const engine = other ? ref_engine(other) : null;
    return open.filter((c) => !engine || engine_of(c.kind) === engine);
  };

  // A new side invalidates the key and column choices made for the old one.
  const set_side = (side: "left" | "right", ref: TableRef | null) =>
    setCompareSetup(tab_key, {
      ...setup,
      [side]: ref,
      key_columns: null,
      excluded_columns: [],
    } satisfies CompareSetup);

  // Key and column choices name shared columns, so they hold either way
  // round. The data results go stale with the sides and clear themselves.
  const swap = () =>
    setCompareSetup(tab_key, {
      ...setup,
      left: setup.right,
      right: setup.left,
    });

  // Repoints the side at the new session, keeping its key and columns.
  const reopen = async (side: "left" | "right") => {
    const ref = setup[side];
    if (!ref) return;
    const conn = await on_reopen(ref.conn_key);
    if (typeof conn === "string") return conn;
    const cur = useStudioStore.getState().compareTabs[tab_key];
    if (!cur?.[side]) return;
    setCompareSetup(tab_key, {
      ...cur,
      [side]: { ...cur[side], conn_id: conn.id, conn_key: stableConnKey(conn) },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
          <SidePicker
            label="Left"
            role="source"
            value={setup.left}
            conn={left_conn}
            candidates={candidates(setup.right)}
            on_change={(ref) => set_side("left", ref)}
            on_reopen={() => reopen("left")}
          />
          <div className="mt-6 flex flex-col items-center gap-1">
            <ArrowRight className="text-muted-foreground size-4" />
            <Button
              size="iconXs"
              variant="ghost"
              disabled={!setup.left && !setup.right}
              onClick={swap}
              aria-label="Swap sides"
              title="Swap sides"
            >
              <ArrowLeftRight className="size-3.5" />
            </Button>
          </div>
          <SidePicker
            label="Right"
            role="target"
            value={setup.right}
            conn={right_conn}
            candidates={candidates(setup.left)}
            on_change={(ref) => set_side("right", ref)}
            on_reopen={() => reopen("right")}
          />
        </div>
        <p className="text-muted-foreground text-caption">
          Differences read as what would change on the right to make it match
          the left.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StructureSection
          tab_key={tab_key}
          setup={setup}
          left_conn={left_conn}
          right_conn={right_conn}
          active={active}
        />
      </div>
    </div>
  );
}

function StructureSection({
  tab_key,
  setup,
  left_conn,
  right_conn,
  active,
}: {
  tab_key: string;
  setup: CompareSetup;
  left_conn: ConnectionInfo | null;
  right_conn: ConnectionInfo | null;
  active: boolean;
}) {
  const { left, right } = setup;
  const [refresh, setRefresh] = useState(0);
  const ready = !!(left && right && left_conn && right_conn);
  const engine: Engine | null = left_conn ? engine_of(left_conn.kind) : null;
  const mongo = engine === "mongodb";

  const key = ready
    ? JSON.stringify([
        left_conn.id,
        left.database,
        left.schema,
        left.table,
        right_conn.id,
        right.database,
        right.schema,
        right.table,
        refresh,
      ])
    : null;

  const schemas = useAsync(key, async () => {
    const load = async (conn: ConnectionInfo, ref: TableRef, side: string) => {
      try {
        const [schema, fields] = await Promise.all([
          tableSchema(conn.id, ref.table, ref.database, ref.schema),
          mongo
            ? mongoFieldTree(conn.id, ref.database ?? "", ref.table)
            : Promise.resolve<FieldShape[]>([]),
        ]);
        return { ...schema, fields };
      } catch (e) {
        throw new Error(
          `${side} (${ref_name(ref)}): ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
    };
    const [l, r] = await Promise.all([
      load(left_conn!, left!, "Left"),
      load(right_conn!, right!, "Right"),
    ]);
    return { left: l, right: r };
  });

  const diff = useMemo(() => {
    if (!schemas.data || !right) return null;
    const { left: l, right: r } = schemas.data;
    return mongo
      ? mongo_structure_diff(
          right.table,
          { fields: r.fields, schema: r },
          { fields: l.fields, schema: l },
        )
      : structure_diff(drafts_toward(right.table, r, l));
  }, [schemas.data, right, mongo]);
  const counts = useMemo(() => (diff ? diff_counts(diff) : null), [diff]);
  const [sync, setSync] = useState<StructureSync | null>(null);
  const [applying, setApplying] = useState(false);
  const push = useStudioStore((s) => s.pushNotification);

  const open_sync = () => {
    if (!schemas.data || !left || !right) return;
    const { left: l, right: r } = schemas.data;
    setSync(
      mongo
        ? mongo_structure_sync(right, l, r)
        : sql_structure_sync(left, right, l, r),
    );
  };

  const apply_sync = async (ops: StructureSync["ops"]) => {
    if (!right || !right_conn) return;
    setApplying(true);
    try {
      const ran = await applySchemaOps(
        right_conn.id,
        ops,
        right.database,
        mongo ? undefined : right.schema,
      );
      push({
        kind: "success",
        title: `Right side structure synced, ${ran.length} ${ran.length === 1 ? "statement" : "statements"} applied`,
        detail: ran.join("\n"),
      });
      setRefresh((n) => n + 1);
    } catch (e) {
      push({
        kind: "error",
        title: "Structure sync failed, nothing was changed",
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setApplying(false);
    }
  };

  if (!left || !right) {
    return (
      <Centered>
        <Empty className="border-none">
          <EmptyHeader>
            <GitCompareArrows className="text-muted-foreground size-6" />
            <EmptyTitle>Pick two tables to compare</EmptyTitle>
            <EmptyDescription>
              Choose a table on each side, on this connection or any other open
              connection of the same engine.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Centered>
    );
  }

  if (!ready) {
    return (
      <Centered>
        <p className="text-muted-foreground text-body">
          Reopen the closed connection, or pick that side again.
        </p>
      </Centered>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-col">
        <div className="bg-background sticky top-0 z-10 flex items-center gap-3 border-b px-3 py-2">
          <h2 className="text-body font-semibold">Structure</h2>
          {counts && (
            <span className="text-small flex items-center gap-1.5 font-mono">
              <span className="text-diff-add-foreground">+{counts.add}</span>
              <span className="text-diff-change-foreground">
                ~{counts.alter}
              </span>
              <span className="text-diff-remove-foreground">
                -{counts.drop}
              </span>
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={!diff || diff.length === 0 || applying}
            onClick={open_sync}
          >
            {applying ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Wrench className="size-3.5" />
            )}
            Sync structure…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={schemas.loading}
            onClick={() => setRefresh((n) => n + 1)}
            aria-label="Refresh structure"
          >
            {schemas.loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>
        {schemas.loading && !schemas.data ? (
          <p className="text-muted-foreground text-small flex items-center gap-2 p-4">
            <Loader2 className="size-3.5 animate-spin" />
            Reading both structures…
          </p>
        ) : schemas.error ? (
          <p className="text-destructive text-small p-4">{schemas.error}</p>
        ) : diff && diff.length === 0 ? (
          <div className="text-body flex items-center gap-2 p-4">
            <CircleCheck className="text-success size-4" />
            Structures match
          </div>
        ) : diff ? (
          <DdlDiffGrid sections={diff} documents={mongo} />
        ) : null}
      </div>
      {schemas.data && (
        <DataSection
          tab_key={tab_key}
          setup={{ ...setup, left, right }}
          left={schemas.data.left}
          right={schemas.data.right}
          left_conn={left_conn}
          right_conn={right_conn}
          active={active}
          structure_differs={!!diff && diff.length > 0}
        />
      )}
      {sync && right_conn && (
        <ApplyChangesDialog
          title={`Sync structure of ${ref_name(right)}`}
          ddl={sync.ddl}
          applying={applying}
          disabled_reason={
            right_conn.read_only
              ? "The right connection is read only: structure changes are refused"
              : sync.ops.length === 0
                ? "Nothing here can be synced"
                : undefined
          }
          notice={
            <SyncNotice
              sync={sync}
              mongo={mongo}
              read_only={!!right_conn.read_only}
            />
          }
          on_apply={() => void apply_sync(sync.ops)}
          on_close={() => setSync(null)}
        />
      )}
    </div>
  );
}

function SyncNotice({
  sync,
  mongo,
  read_only,
}: {
  sync: StructureSync;
  mongo: boolean;
  read_only: boolean;
}) {
  const notes: string[] = [];
  if (read_only)
    notes.push("The right connection is read only, so this can't be applied.");
  if (sync.dropped_columns.length > 0)
    notes.push(
      `Dropping ${sync.dropped_columns.join(", ")} deletes ${sync.dropped_columns.length === 1 ? "that column's" : "those columns'"} data on the right. A renamed column shows as a drop plus an add.`,
    );
  if (sync.triggers_left_out)
    notes.push(
      "Trigger changes are shown in the comparison but left out here: the table names differ, and trigger SQL names its own table.",
    );
  if (mongo)
    notes.push(
      "Only indexes sync. Field shapes live in the documents, which Sync data changes.",
    );
  if (notes.length === 0) return null;
  return (
    <div className="bg-warning/10 text-warning rounded-control text-small flex flex-col gap-1 p-2">
      {notes.map((n) => (
        <p key={n} className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {n}
        </p>
      ))}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center p-6">
      {children}
    </div>
  );
}
