import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Download,
  FileCode,
  Loader2,
  Square,
  TriangleAlert,
} from "lucide-react";
import {
  cancelRun,
  compareDataToFile,
  type CompareFileKind,
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { useStudioStore } from "@/shared/store";
import type { DataRequest } from "../lib/data-runs";

const fmt = (n: number) => n.toLocaleString();

const FILES: Record<
  CompareFileKind,
  { label: string; ext: (mongo: boolean) => string; filter: string }
> = {
  csv: { label: "CSV", ext: () => "csv", filter: "CSV" },
  json: { label: "JSON", ext: () => "json", filter: "JSON" },
  sync_script: {
    label: "sync script",
    ext: (mongo) => (mongo ? "js" : "sql"),
    filter: "Script",
  },
};

/** One file run at a time per compare tab: an export or a sync script, read
 *  fresh from both sides, stoppable. */
export function useFileRun(req: DataRequest | null, mongo: boolean) {
  const push = useStudioStore((s) => s.pushNotification);
  const [running, setRunning] = useState<{
    kind: CompareFileKind;
    run_id: string;
    stopping: boolean;
  } | null>(null);

  const start = async (kind: CompareFileKind) => {
    if (!req || running) return;
    const meta = FILES[kind];
    const ext = meta.ext(mongo);
    let path: string | null = null;
    if (!WEB) {
      const base = `${req.left.table}-vs-${req.right.table}${kind === "sync_script" ? "-sync" : ""}`;
      const picked = await save({
        defaultPath: `${base}.${ext}`,
        filters: [{ name: meta.filter, extensions: [ext] }],
      });
      if (!picked || Array.isArray(picked)) return;
      path = picked;
    }
    const run_id = crypto.randomUUID();
    setRunning({ kind, run_id, stopping: false });
    try {
      const res = await compareDataToFile(
        {
          ...req,
          run_id,
          after_key: null,
          count_all: true,
          page_size: 0,
        },
        kind,
        path,
      );
      if (res.where === "download") {
        push({ kind: "success", title: `Downloaded ${res.name}` });
      } else if (res.summary.status === "stopped") {
        push({ kind: "info", title: "Stopped, no file was written" });
      } else {
        const n = res.summary.rows_written;
        push({
          kind: "success",
          title:
            kind === "sync_script"
              ? `Sync script written for ${fmt(n)} ${n === 1 ? "difference" : "differences"}`
              : `Exported ${fmt(n)} ${n === 1 ? "difference" : "differences"}`,
          detail: res.summary.path,
        });
      }
    } catch (e) {
      push({
        kind: "error",
        title:
          kind === "sync_script"
            ? "Could not write the sync script"
            : "Export failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(null);
    }
  };

  const stop = () => {
    if (!req || !running || running.stopping) return;
    setRunning({ ...running, stopping: true });
    void cancelRun(req.left.conn_id, running.run_id).catch(() => {
      setRunning((cur) => cur && { ...cur, stopping: false });
    });
  };

  return { running, start, stop };
}

export function ExportMenu({
  disabled,
  on_export,
}: {
  disabled: boolean;
  on_export: (kind: "csv" | "json") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button size="sm" variant="outline">
            <Download className="size-3.5" />
            Export
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => on_export("csv")}>
          Every difference as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => on_export("json")}>
          Every difference as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A file run in progress, with its Stop. */
export function FileRunStatus({
  running,
  on_stop,
}: {
  running: { kind: CompareFileKind; stopping: boolean };
  on_stop: () => void;
}) {
  return (
    <span className="text-muted-foreground text-small flex items-center gap-2">
      <Loader2 className="size-3.5 animate-spin" />
      {running.kind === "sync_script"
        ? "Writing the sync script…"
        : `Exporting ${FILES[running.kind].label}…`}
      <Button
        size="sm"
        variant="ghost"
        disabled={running.stopping}
        onClick={on_stop}
      >
        <Square className="text-destructive size-3 fill-current" />
        {running.stopping ? "Stopping…" : "Stop"}
      </Button>
    </span>
  );
}

/** Explains the data sync script before it is written. */
export function SyncDataDialog({
  open,
  on_open_change,
  mongo,
  columns,
  structure_differs,
  right_name,
  on_write,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  mongo: boolean;
  columns: number;
  structure_differs: boolean;
  right_name: string;
  on_write: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={on_open_change}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync data</DialogTitle>
          <DialogDescription>
            Writes a script that makes the rows of{" "}
            <span className="text-foreground font-mono">{right_name}</span>{" "}
            match the left for the {fmt(columns)} compared{" "}
            {columns === 1 ? "column" : "columns"}.
          </DialogDescription>
        </DialogHeader>
        <ul className="text-small text-muted-foreground flex list-disc flex-col gap-1 pl-5">
          {mongo ? (
            <li>
              A mongosh script of <code>insertOne</code>, <code>updateOne</code>{" "}
              with <code>$set</code> and <code>$unset</code>, and{" "}
              <code>deleteOne</code> by key.
            </li>
          ) : (
            <li>
              One transaction of INSERT, UPDATE (only the differing columns),
              and DELETE statements, keyed by the key columns.
            </li>
          )}
          <li>
            It is read fresh from both sides and covers every difference, not
            only the page on screen.
          </li>
          <li>Nothing runs. Read the script, then run it yourself.</li>
        </ul>
        {structure_differs && (
          <p className="bg-warning/10 text-warning rounded-control text-small flex items-start gap-2 p-2">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            The structures differ. Sync the structure first, or the script may
            fail on columns the right side doesn't have.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => on_open_change(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              on_open_change(false);
              on_write();
            }}
          >
            <FileCode className="size-3.5" />
            {WEB ? "Download script" : "Write script…"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
