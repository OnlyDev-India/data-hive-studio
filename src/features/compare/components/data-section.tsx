import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Columns3,
  FileCode,
  KeyRound,
  ListFilter,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import type { ConnectionInfo, TableRef, TableSchema } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  RowDiffGrid,
  type DiffGridRow,
  type DiffRowAction,
} from "@/shared/components/diff-grid";
import { useAppShortcut, useShortcuts } from "@/shared/hooks/use-shortcut";
import { cn } from "@/shared/lib/utils";
import { useStudioStore, type CompareSetup } from "@/shared/store";
import { plan_data } from "../lib/data-setup";
import { engine_of, ref_name } from "../lib/refs";
import { open_row } from "../lib/open-row";
import {
  DIFF_PAGE_SIZE,
  start_data_diff,
  stop_data_diff,
  turn_page,
  useDataRun,
  type DataRequest,
  type DataRun,
} from "../lib/data-runs";
import {
  ExportMenu,
  FileRunStatus,
  SyncDataDialog,
  useFileRun,
} from "./file-actions";

const fmt = (n: number) => n.toLocaleString();

/** The row diff: runs only on "Compare data", streams its differences into
 *  the grid, and can be stopped. */
export function DataSection({
  tab_key,
  setup,
  left,
  right,
  left_conn,
  right_conn,
  active,
  structure_differs,
}: {
  tab_key: string;
  setup: CompareSetup & { left: TableRef; right: TableRef };
  left: TableSchema;
  right: TableSchema;
  left_conn: ConnectionInfo;
  right_conn: ConnectionInfo;
  active: boolean;
  /** The structure diff is not empty (the sync script warns). */
  structure_differs: boolean;
}) {
  const setCompareSetup = useStudioStore((s) => s.setCompareSetup);
  const plan = useMemo(
    () => plan_data(setup, left, right),
    [setup, left, right],
  );
  const filter = setup.filter.trim();
  const sig = JSON.stringify([
    left_conn.id,
    setup.left,
    right_conn.id,
    setup.right,
    plan.key,
    plan.columns,
    filter,
  ]);

  const run = useDataRun(tab_key);
  const running = run?.status === "running";

  // Any change to the sides, key, columns, or filter makes the results
  // stale: they stay on screen and Compare data asks to be run again.
  const stale = !!run && run.sig !== sig;
  useEffect(() => {
    if (stale) void stop_data_diff(tab_key);
  }, [stale, tab_key]);

  const request: DataRequest | null = plan.blocked
    ? null
    : {
        left: { ...setup.left, conn_id: left_conn.id },
        right: { ...setup.right, conn_id: right_conn.id },
        key_columns: plan.key,
        columns: plan.columns,
        filter: filter || null,
      };
  const start = () => {
    if (request) void start_data_diff(tab_key, sig, request);
  };
  const stop = () => void stop_data_diff(tab_key);

  const runBinding = useAppShortcut("editor.run");
  useShortcuts([{ ...runBinding, handler: running ? stop : start }], {
    enabled: active,
  });

  const set = (patch: Partial<CompareSetup>) =>
    setCompareSetup(tab_key, { ...setup, ...patch });

  const non_key = plan.shared.filter((c) => !plan.key.includes(c));
  const mongo = engine_of(left_conn.kind) === "mongodb";
  const file = useFileRun(request, mongo);
  const [sync_open, setSyncOpen] = useState(false);

  return (
    <section className="flex flex-col border-t">
      <div className="bg-background sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-body mr-1 font-semibold">Data</h2>
        <KeyPicker
          shared={plan.shared}
          value={plan.key}
          overridden={!!setup.key_columns?.length}
          disabled={running}
          on_change={(key_columns) =>
            set({ key_columns: key_columns.length ? key_columns : null })
          }
        />
        <ColumnPicker
          candidates={non_key}
          excluded={setup.excluded_columns}
          disabled={running}
          on_change={(excluded_columns) => set({ excluded_columns })}
        />
        <FilterInput
          key={setup.filter}
          value={setup.filter}
          mongo={mongo}
          disabled={running}
          on_change={(f) => set({ filter: f })}
        />
        <div className="ml-auto flex items-center gap-2">
          {file.running && (
            <FileRunStatus running={file.running} on_stop={file.stop} />
          )}
          <ExportMenu
            disabled={!request || !!file.running}
            on_export={(kind) => void file.start(kind)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!request || !!file.running}
            onClick={() => setSyncOpen(true)}
          >
            <FileCode className="size-3.5" />
            Sync data…
          </Button>
          {running ? (
            <Button
              size="sm"
              variant="outline"
              disabled={run.stopping}
              onClick={stop}
            >
              <Square className="text-destructive size-3 fill-current" />
              {run.stopping ? "Stopping…" : "Stop"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!!plan.blocked}
              title={plan.blocked ?? undefined}
              className={cn(
                stale &&
                  !plan.blocked &&
                  "ring-primary/50 ring-offset-background ring-2 ring-offset-1",
              )}
              onClick={start}
            >
              <Play className="size-3.5" />
              Compare data
            </Button>
          )}
        </div>
      </div>
      <SyncDataDialog
        open={sync_open}
        on_open_change={setSyncOpen}
        mongo={mongo}
        columns={plan.columns.length}
        structure_differs={structure_differs}
        right_name={ref_name(setup.right)}
        on_write={() => void file.start("sync_script")}
      />
      {plan.blocked ? (
        <p className="text-muted-foreground text-small px-3 py-2">
          {plan.blocked}
        </p>
      ) : !run ? (
        <p className="text-muted-foreground text-small px-3 py-2">
          Compares {fmt(plan.columns.length)}{" "}
          {plan.columns.length === 1 ? "column" : "columns"} by{" "}
          {plan.key.join(", ")}. Rows are read in key order, so any table size
          works.
        </p>
      ) : (
        <>
          {stale && (
            <p className="text-muted-foreground text-small border-b px-3 py-2">
              The setup changed. These are the last results, run Compare data to
              update them.
            </p>
          )}
          <RunView run={run} tab_key={tab_key} mongo={mongo} />
        </>
      )}
    </section>
  );
}

/** Open row: a row only on one side opens there; a changed row either. */
function row_actions(
  run: DataRun,
  mongo: boolean,
): (row: DiffGridRow, index: number) => DiffRowAction[] {
  return (row, index) => {
    const k = run.keys[index];
    if (!k) return [];
    const open = (side: "left" | "right") => () =>
      open_row(
        run.req[side],
        run.req[side].conn_id,
        mongo,
        run.key_columns,
        k.key,
        k.display,
      );
    const left = { label: "Open row on the left", run: open("left") };
    const right = { label: "Open row on the right", run: open("right") };
    return row.kind === "insert"
      ? [left]
      : row.kind === "delete"
        ? [right]
        : [left, right];
  };
}

function RunView({
  run,
  tab_key,
  mongo,
}: {
  run: DataRun;
  tab_key: string;
  mongo: boolean;
}) {
  const actions = useMemo(() => row_actions(run, mongo), [run, mongo]);
  if (run.status === "error") {
    return (
      <p className="text-destructive text-small px-3 py-2 whitespace-pre-wrap">
        {run.error}
      </p>
    );
  }
  const { counts, rows_read } = run;
  const differences = counts.changed + counts.left_only + counts.right_only;
  return (
    <>
      <div className="text-small flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2">
        {run.status === "running" ? (
          <span className="text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            Comparing, {fmt(rows_read.left)} left and {fmt(rows_read.right)}{" "}
            right rows read
          </span>
        ) : run.status === "stopped" ? (
          <span className="text-muted-foreground">
            Stopped after reading {fmt(rows_read.left)} left and{" "}
            {fmt(rows_read.right)} right rows
          </span>
        ) : differences === 0 ? (
          <span className="flex items-center gap-1.5">
            <CircleCheck className="text-success size-3.5" />
            Rows match
          </span>
        ) : (
          <span>
            {fmt(differences)}{" "}
            {differences === 1 ? "difference" : "differences"}
          </span>
        )}
        <span className="flex items-center gap-3 font-mono">
          <span className="text-muted-foreground" title="Identical rows">
            ={fmt(counts.identical)}
          </span>
          <span className="text-diff-change-foreground" title="Changed rows">
            ~{fmt(counts.changed)}
          </span>
          <span
            className="text-diff-add-foreground"
            title="Only on the left (would be inserted into the right)"
          >
            +{fmt(counts.left_only)}
          </span>
          <span
            className="text-diff-remove-foreground"
            title="Only on the right (would be deleted)"
          >
            −{fmt(counts.right_only)}
          </span>
        </span>
      </div>
      {run.total_diffs !== null && run.total_diffs > DIFF_PAGE_SIZE && (
        <PageBanner run={run} total={run.total_diffs} tab_key={tab_key} />
      )}
      {run.rows.length > 0 && (
        <RowDiffGrid
          rows={run.rows}
          columns={run.columns}
          gutter_label={run.key_columns.join(", ")}
          row_actions={actions}
          className="max-h-[70vh]"
        />
      )}
    </>
  );
}

/** Which slice of the differences the grid holds, with paging once the
 *  first run has finished. */
function PageBanner({
  run,
  total,
  tab_key,
}: {
  run: DataRun;
  total: number;
  tab_key: string;
}) {
  const from = run.page * DIFF_PAGE_SIZE + 1;
  const to = run.page * DIFF_PAGE_SIZE + run.rows.length;
  const done = run.status === "done";
  return (
    <div className="text-muted-foreground text-small flex items-center gap-2 border-b px-3 py-1.5">
      <span>
        {run.rows.length === 0
          ? `Reading page ${fmt(run.page + 1)} of the differences`
          : `Showing differences ${fmt(from)} to ${fmt(to)} of ${fmt(total)}`}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!done || run.page === 0}
          onClick={() => void turn_page(tab_key, -1)}
        >
          <ChevronLeft className="size-3.5" />
          Previous
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!done || !run.next_key}
          onClick={() => void turn_page(tab_key, 1)}
        >
          Next
          <ChevronRight className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}

function KeyPicker({
  shared,
  value,
  overridden,
  disabled,
  on_change,
}: {
  shared: string[];
  value: string[];
  overridden: boolean;
  disabled: boolean;
  on_change: (key: string[]) => void;
}) {
  const toggle = (col: string, on: boolean) =>
    on_change(on ? [...value, col] : value.filter((c) => c !== col));
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button size="sm" variant="outline">
            <KeyRound className="size-3.5" />
            <span className="max-w-48 truncate">
              Key: {value.length ? value.join(", ") : "none"}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64 p-2">
        <p className="text-muted-foreground text-caption px-1 pb-1.5">
          Columns on both sides. The key must be unique and never NULL.
        </p>
        <div className="max-h-64 overflow-y-auto">
          {shared.map((col) => (
            <label
              key={col}
              className="hover:bg-muted text-small rounded-control flex cursor-pointer items-center gap-2 px-1 py-1"
            >
              <Checkbox
                checked={value.includes(col)}
                onCheckedChange={(on) => toggle(col, on === true)}
              />
              <span className="truncate font-mono">{col}</span>
            </label>
          ))}
        </div>
        {overridden && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-1 w-full"
            onClick={() => on_change([])}
          >
            Use the primary key
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ColumnPicker({
  candidates,
  excluded,
  disabled,
  on_change,
}: {
  candidates: string[];
  excluded: string[];
  disabled: boolean;
  on_change: (excluded: string[]) => void;
}) {
  const out = new Set(excluded);
  const compared = candidates.filter((c) => !out.has(c)).length;
  const toggle = (col: string, on: boolean) =>
    on_change(on ? excluded.filter((c) => c !== col) : [...excluded, col]);
  return (
    <Popover>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button size="sm" variant="outline">
            <Columns3 className="size-3.5" />
            Columns: {compared} of {candidates.length}
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-64 p-2">
        <p className="text-muted-foreground text-caption px-1 pb-1.5">
          Compared columns. Columns on only one side show in the structure diff
          instead.
        </p>
        <div className="max-h-64 overflow-y-auto">
          {candidates.map((col) => (
            <label
              key={col}
              className="hover:bg-muted text-small rounded-control flex cursor-pointer items-center gap-2 px-1 py-1"
            >
              <Checkbox
                checked={!out.has(col)}
                onCheckedChange={(on) => toggle(col, on === true)}
              />
              <span className="truncate font-mono">{col}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One filter for both sides, applied on Enter or when you leave the box,
 *  so typing doesn't reset the results on every key. Keyed by the saved
 *  filter, so a change from elsewhere resets the draft. */
function FilterInput({
  value,
  mongo,
  disabled,
  on_change,
}: {
  value: string;
  mongo: boolean;
  disabled: boolean;
  on_change: (filter: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() !== value.trim()) on_change(draft.trim());
  };
  return (
    <InputGroup className="h-7 w-72 max-w-full">
      <InputGroupAddon>
        <ListFilter className="size-3.5" />
        {!mongo && <span className="text-caption font-mono">WHERE</span>}
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Filter for both sides"
        className="text-small font-mono"
        placeholder={mongo ? '{ "status": "active" }' : "status = 'active'"}
        title="Applies to both sides, read only"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </InputGroup>
  );
}
