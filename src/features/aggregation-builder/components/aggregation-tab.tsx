import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  Play,
  Redo2,
  RefreshCw,
  Square,
  Undo2,
  WifiOff,
} from "lucide-react";
import {
  composePipeline,
  envConfirmReason,
  isProductionEnv,
  mongoFieldTree,
  type ComposedPipeline,
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import {
  DEFAULT_AGGREGATION_SETUP,
  useStudioStore,
  type AggregationSetup,
  type AggregationStage,
  type StudioTab,
} from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { useWriteConfirm } from "@/shared/hooks/use-write-confirm";
import type { CardActions } from "../lib/card-actions";
import { cardFaults, hasFault } from "../lib/card-state";
import {
  codeInput,
  DRIVER_LANGS,
  driverCode,
  type DriverLang,
} from "../lib/codegen";
import { fieldSuggestions, joinedCollection, treePaths } from "../lib/fields";
import {
  EMPTY_HISTORY,
  historyOf,
  record,
  redo,
  setHistory,
  undo,
  type History,
} from "../lib/history";
import {
  addBranch,
  chainOf,
  changeOp,
  enabledOnly,
  duplicateStage,
  findStage,
  insertStage,
  lastSlot,
  moveStage,
  newStage,
  patchStage,
  removeBranch,
  removeStage,
  renameBranch,
  setSubPipeline,
  stageLabel,
  toSpec,
  withChain,
  type ChainRef,
} from "../lib/model";
import { isConnectionLost } from "../lib/offline";
import { openPipelineFile } from "../lib/open";
import { isWriteOp } from "../lib/operators";
import { useExplain } from "../lib/use-explain";
import { usePipelineFile } from "../lib/use-pipeline-file";
import { usePipelineRun } from "../lib/use-pipeline-run";
import { usePreviews } from "../lib/use-previews";
import {
  BuilderBottomPanel,
  type PanelTab,
  type PanelView,
} from "./builder-bottom-panel";
import { CollectionPicker } from "./collection-picker";
import { PasteDialog } from "./paste-dialog";
import { PipelineCanvas } from "./pipeline-canvas";
import { SettingsPopover } from "./settings-popover";
import { SwitchCollectionDialog } from "./switch-collection-dialog";

type AggregationTabKind = Extract<StudioTab, { kind: "aggregation" }>;

/** How long typing must pause before it counts as one undo step. */
const TEXT_COMMIT_MS = 1000;

/** Where a final `$out` or `$merge` writes, read from the composed stage. */
function writeTarget(
  composed: ComposedPipeline | null,
): { op: string; target: string } | null {
  const last = composed?.canonical.at(-1) as
    Record<string, unknown> | undefined;
  if (!last) return null;
  const op = Object.keys(last)[0];
  if (!isWriteOp(op)) return null;
  const value = last[op];
  const named = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return [o.db, o.coll].filter((p) => typeof p === "string").join(".");
    }
    return "";
  };
  const target =
    op === "$merge"
      ? named((value as Record<string, unknown> | undefined)?.into ?? value)
      : named(value);
  return { op, target };
}

/** An aggregation builder: the pipeline as cards on a canvas, each with its
 *  output previewed, and the full result or the pipeline text on demand. */
export function AggregationTab({
  conn_id,
  tab_key,
  tab,
  active,
}: {
  conn_id: string;
  tab_key: string;
  tab: AggregationTabKind;
  /** The visible tab, the only one that takes Cmd+Z. */
  active: boolean;
}) {
  const stored = useStudioStore((s) => s.aggregationTabs[tab_key]);
  const setup = stored ?? DEFAULT_AGGREGATION_SETUP;
  const setSetup = useStudioStore((s) => s.setAggregationSetup);
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const { database, collection } = tab;

  const update = useCallback(
    (fn: (cur: AggregationSetup) => AggregationSetup) => {
      const cur =
        useStudioStore.getState().aggregationTabs[tab_key] ??
        DEFAULT_AGGREGATION_SETUP;
      setSetup(tab_key, fn(cur));
    },
    [setSetup, tab_key],
  );

  const previews = usePreviews({ conn_id, database, collection, setup });
  const { run, start, stop } = usePipelineRun({
    conn_id,
    database,
    collection,
    setup,
  });
  const confirm = useWriteConfirm(conn_id);
  const explain = useExplain({ conn_id, database, collection });
  const [panel, setPanel] = useState<PanelTab>("stage");
  const [view, setView] = useState<PanelView>("grid");
  const [copied, setCopied] = useState(false);
  const [pasting, setPasting] = useState(false);

  // Undo history: every structural change is one step; a run of typing in
  // one card (or its title or note) is one step, closed on blur or after
  // TEXT_COMMIT_MS without typing.
  const [hist, setHist] = useState(() => historyOf(tab_key));
  const burst = useRef<string | null>(null);
  const burst_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const history = useMemo(() => {
    const save = (h: History) => {
      setHistory(tab_key, h);
      setHist(h);
    };
    const close = () => {
      burst.current = null;
      if (burst_timer.current) clearTimeout(burst_timer.current);
      burst_timer.current = null;
    };
    const change = (
      fn: (cur: AggregationSetup) => AggregationSetup,
      text?: string,
    ) => {
      const cur =
        useStudioStore.getState().aggregationTabs[tab_key] ??
        DEFAULT_AGGREGATION_SETUP;
      const next = fn(cur);
      if (next.stages !== cur.stages) {
        if (!text || burst.current !== text) {
          close();
          save(record(historyOf(tab_key), cur.stages));
        }
        if (text) {
          burst.current = text;
          if (burst_timer.current) clearTimeout(burst_timer.current);
          burst_timer.current = setTimeout(close, TEXT_COMMIT_MS);
        }
      }
      setSetup(tab_key, next);
    };
    const step = (dir: "undo" | "redo") => {
      close();
      const cur =
        useStudioStore.getState().aggregationTabs[tab_key] ??
        DEFAULT_AGGREGATION_SETUP;
      const [h, stages] = (dir === "undo" ? undo : redo)(
        historyOf(tab_key),
        cur.stages,
      );
      if (!stages) return;
      save(h);
      const sel = cur.selected_stage_id;
      setSetup(tab_key, {
        ...cur,
        stages,
        selected_stage_id: findStage(stages, sel) ? sel : null,
      });
    };
    return {
      change,
      close,
      undo: () => step("undo"),
      redo: () => step("redo"),
    };
  }, [setSetup, tab_key]);

  useEffect(() => history.close, [history]);

  const actions: CardActions = useMemo(() => {
    const { change } = history;
    return {
      setBody: (id, body) =>
        change(
          (s) => ({ ...s, stages: patchStage(s.stages, id, { body }) }),
          `body:${id}`,
        ),
      setOp: (id, op) =>
        change((s) => {
          const stage = findStage(s.stages, id);
          if (!stage) return s;
          const next = changeOp(stage, op, chainOf(s.stages, id) !== null);
          // A card that loses its side chains loses their cards too.
          const stages = patchStage(s.stages, id, {
            ...next,
            branches: next.branches,
          });
          return {
            ...s,
            stages,
            selected_stage_id: findStage(stages, s.selected_stage_id)
              ? s.selected_stage_id
              : id,
          };
        }),
      setText: (id, field, text) =>
        change(
          (s) => ({
            ...s,
            stages: patchStage(s.stages, id, { [field]: text }),
          }),
          `${field}:${id}`,
        ),
      setFlags: (id, flags) =>
        change((s) => ({ ...s, stages: patchStage(s.stages, id, flags) })),
      commitText: history.close,
      remove: (id) =>
        change((s) => {
          const stages = removeStage(s.stages, id);
          return {
            ...s,
            stages,
            selected_stage_id: findStage(stages, s.selected_stage_id)
              ? s.selected_stage_id
              : null,
          };
        }),
      duplicate: (id) =>
        change((s) => {
          const { stages, copy } = duplicateStage(s.stages, id);
          return copy ? { ...s, stages, selected_stage_id: copy.id } : s;
        }),
      move: (id, index) =>
        change((s) => ({ ...s, stages: moveStage(s.stages, id, index) })),
      select: (id) => {
        update((s) => ({ ...s, selected_stage_id: id }));
        setPanel("stage");
      },
      insert: (index, op, chain: ChainRef = null) => {
        const stage = newStage(op, chain !== null);
        change((s) => ({
          ...s,
          stages: withChain(s.stages, chain, (c) =>
            insertStage(c, index, stage),
          ),
          selected_stage_id: stage.id,
        }));
        setPanel("stage");
      },
      addBranch: (parent) =>
        change((s) => ({ ...s, stages: addBranch(s.stages, parent).stages })),
      renameBranch: (parent, key, next) =>
        change((s) => ({
          ...s,
          stages: renameBranch(s.stages, parent, key, next),
        })),
      removeBranch: (parent, key) =>
        change((s) => {
          const stages = removeBranch(s.stages, parent, key);
          return {
            ...s,
            stages,
            selected_stage_id: findStage(stages, s.selected_stage_id)
              ? s.selected_stage_id
              : null,
          };
        }),
      setSubPipeline: (parent, on) =>
        change((s) => {
          const stages = setSubPipeline(s.stages, parent, on);
          return {
            ...s,
            stages,
            selected_stage_id: findStage(stages, s.selected_stage_id)
              ? s.selected_stage_id
              : null,
          };
        }),
    };
  }, [history, update]);

  // Cmd+Z and Cmd+Shift+Z on the canvas. A focused editor or box keeps its
  // own undo.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z")
        return;
      const t = e.target as HTMLElement | null;
      if (
        t?.closest(
          ".cm-editor, input, textarea, select, [contenteditable='true'], [role='dialog']",
        )
      )
        return;
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, history]);

  const [tree, setTree] = useState<string[]>([]);
  useEffect(() => {
    if (!conn) return;
    let live = true;
    mongoFieldTree(conn_id, database, collection)
      .then((t) => {
        if (live) setTree(treePaths(t));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [conn, conn_id, database, collection]);
  // The fields of each collection a `$lookup` or `$unionWith` side chain
  // reads, fetched once per name.
  const joined_key = [
    ...new Set(
      setup.stages
        .filter((s) => s.branches?.length)
        .map(joinedCollection)
        .filter((n): n is string => !!n),
    ),
  ]
    .sort()
    .join("\n");
  const [trees, setTrees] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!conn || !joined_key) return;
    let live = true;
    for (const name of joined_key.split("\n")) {
      mongoFieldTree(conn_id, database, name)
        .then((t) => {
          if (live) setTrees((cur) => ({ ...cur, [name]: treePaths(t) }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [conn, conn_id, database, joined_key]);
  const fields = useMemo(
    () => fieldSuggestions(setup.stages, previews.cards, tree, trees),
    [setup.stages, previews.cards, tree, trees],
  );

  const composed = previews.composed;
  const file = usePipelineFile({ tab_key, collection, setup, composed });
  const faults = useMemo(
    () => cardFaults(setup.stages, composed?.errors ?? [], previews.cards),
    [setup.stages, composed, previews.cards],
  );
  const has_errors = hasFault(faults);
  const enabled = setup.stages.filter((s) => s.enabled);
  const sampled =
    previews.estimate !== null && previews.estimate > setup.preview_cap;
  const selected = findStage(setup.stages, setup.selected_stage_id);
  const running = !!run?.running;
  const ready = enabled.length > 0 && !has_errors && !!composed;
  const run_lost = !running && isConnectionLost(run?.error);
  const offline = previews.offline || run_lost;
  const can_run = !!conn && ready && !offline;
  const writes = enabled.some((s) => isWriteOp(s.op));

  const onRun = async () => {
    const write = writeTarget(composed);
    if (write && conn && !conn.read_only) {
      const replaced = write.op === "$out";
      const reason = envConfirmReason(conn);
      const typed = isProductionEnv(conn) && write.target;
      const ok = await confirm.ask({
        title: "Run a pipeline that writes",
        description: replaced
          ? `The result replaces every document in ${write.target}.`
          : `The result is merged into ${write.target}.`,
        items: [
          {
            text: `${replaced ? "Replace" : "Merge into"} collection ${write.target}`,
            reasons: reason ? [reason] : [],
          },
        ],
        confirm_label: "Run",
        ...(typed ? { type_to_confirm: write.target } : {}),
      });
      if (!ok) return;
    }
    setPanel("run");
    start();
  };

  /** Shell text keeps titles and notes as comments; JSON has none. */
  const copyText = async (
    kind: "shell" | "json" | DriverLang,
  ): Promise<string | null> => {
    if (!composed) return null;
    if (kind === "json") return composed.json;
    if (kind === "shell") {
      const c = await composePipeline(
        collection,
        toSpec(enabledOnly(setup.stages)),
      );
      return c.file.trimEnd();
    }
    return driverCode(
      kind,
      codeInput(composed.canonical, collection, setup.stages),
    );
  };
  const copy = (kind: "shell" | "json" | DriverLang) => {
    void copyText(kind)
      .then((text) => {
        if (text !== null) return navigator.clipboard.writeText(text);
      })
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
  };

  const onExplain = (analyze: boolean) => {
    if (!composed) return;
    setPanel("plan");
    explain.explain(composed.shell, analyze);
  };

  const onPaste = (stages: AggregationStage[], mode: "replace" | "append") =>
    history.change((s) => ({
      ...s,
      stages:
        mode === "replace"
          ? stages
          : [
              ...s.stages.slice(0, lastSlot(s.stages)),
              ...stages,
              ...s.stages.slice(lastSlot(s.stages)),
            ],
      selected_stage_id: mode === "replace" ? null : s.selected_stage_id,
    }));

  // Cmd+S saves to the tab's file, or asks where.
  useEffect(() => {
    if (!active || WEB) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (ready) void file.save(e.shiftKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, ready, file]);

  // Another collection starts an empty pipeline, so a pipeline that is not
  // saved to its file asks first.
  const [switch_to, setSwitchTo] = useState<{
    database: string;
    collection: string;
  } | null>(null);
  const setCollection = useStudioStore((s) => s.setAggregationCollection);
  const switchCollection = (to: { database: string; collection: string }) => {
    history.close();
    setHistory(tab_key, EMPTY_HISTORY);
    setHist(EMPTY_HISTORY);
    setCollection(conn_id, tab.id, to.database, to.collection);
  };
  const pickCollection = (database: string, collection: string) => {
    const kept = !!file.file_name && !file.is_dirty;
    if (setup.stages.length === 0 || kept)
      switchCollection({ database, collection });
    else setSwitchTo({ database, collection });
  };

  const tail = setup.stages.at(-1);
  const can_append = !tail || !isWriteOp(tail.op);
  const fix_first = "Fix or disable the stages with errors first";

  const history_buttons = (
    <>
      <Button
        variant="ghost"
        size="iconXs"
        onClick={history.undo}
        disabled={hist.past.length === 0}
        aria-label="Undo"
        title="Undo (⌘Z)"
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="iconXs"
        onClick={history.redo}
        disabled={hist.future.length === 0}
        aria-label="Redo"
        title="Redo (⇧⌘Z)"
      >
        <Redo2 className="size-3.5" />
      </Button>
    </>
  );

  const bar = (
    <div
      role="toolbar"
      aria-label="Pipeline"
      className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
    >
      <CollectionPicker
        conn_id={conn_id}
        database={database}
        collection={collection}
        onPick={pickCollection}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" title="Paste, open or save">
              <FileText className="size-3.5" />
              File
              <ChevronDown className="size-3" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={() => setPasting(true)}>
            Paste pipeline…
          </DropdownMenuItem>
          {!WEB && (
            <>
              <DropdownMenuItem
                onClick={() =>
                  void openPipelineFile(conn_id, { database, collection })
                }
              >
                Open pipeline file…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!ready}
                title={has_errors ? fix_first : undefined}
                onClick={() => void file.save(false)}
              >
                Save
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!ready}
                title={has_errors ? fix_first : undefined}
                onClick={() => void file.save(true)}
              >
                Save as…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const toolbar = (
    <div
      role="toolbar"
      aria-label="Aggregation"
      className="flex flex-wrap items-center justify-end gap-1.5"
    >
      {!setup.auto_preview && (
        <Button
          variant="outline"
          size="sm"
          onClick={previews.refresh}
          disabled={!conn || setup.stages.length === 0}
        >
          <RefreshCw className="size-3.5" />
          Preview
        </Button>
      )}
      {previews.refreshing && (
        <span
          role="status"
          className="text-muted-foreground text-small flex items-center gap-1.5"
        >
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
          Previewing
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <SettingsPopover
          id={tab_key}
          setup={setup}
          onChange={(patch) => update((s) => ({ ...s, ...patch }))}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={!ready}
                title={has_errors ? fix_first : "Copy the pipeline"}
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => copy("shell")}>
              Shell (db.{collection}.aggregate)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copy("json")}>
              Pipeline JSON array
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {DRIVER_LANGS.map(({ lang, label }) => (
              <DropdownMenuItem key={lang} onClick={() => copy(lang)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                disabled={!ready || !conn || offline}
                title={has_errors ? fix_first : "Show the pipeline's plan"}
              >
                Explain
                <ChevronDown className="size-3" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => onExplain(false)}>
              Estimate
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={writes}
              title={
                writes
                  ? "A pipeline that writes is only estimated"
                  : "Runs the pipeline to measure it"
              }
              onClick={() => onExplain(true)}
            >
              With analyze
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {running ? (
          <Button
            variant="outline"
            size="sm"
            onClick={stop}
            disabled={!stop || run?.stopping}
          >
            <Square className="size-3.5" />
            {run?.stopping ? "Stopping…" : "Stop"}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => void onRun()}
            disabled={!can_run}
            title={
              has_errors ? fix_first : "Run the whole pipeline, with no cap"
            }
          >
            <Play className="size-3.5" />
            Run
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bar}
      {offline && (
        <div
          role="status"
          className="bg-muted/60 text-small text-muted-foreground flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
        >
          <WifiOff className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            Not connected. You can keep editing, copying and saving; previews
            and Run wait for the server.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6"
            disabled={!conn || previews.refreshing}
            onClick={previews.refresh}
          >
            {previews.refreshing ? (
              <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            Reconnect
          </Button>
        </div>
      )}
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel id="canvas" minSize="25%" className="border-b">
          <PipelineCanvas
            stages={setup.stages}
            selectedId={setup.selected_stage_id}
            previews={previews.cards}
            faults={faults}
            fields={fields}
            cap={setup.preview_cap}
            sampled={sampled}
            actions={actions}
            toolbar={toolbar}
            history={history_buttons}
            exportName={
              file.file_name?.replace(/\.[^.]+$/, "") ??
              `${collection}-pipeline`
            }
          />
        </ResizablePanel>
        <ResizableHandle className="bg-background hover:bg-accent h-1!" />
        <ResizablePanel id="output" defaultSize="35%" minSize="12%">
          <BuilderBottomPanel
            conn_id={conn_id}
            tab_key={tab_key}
            database={database}
            tab={panel}
            onTab={setPanel}
            view={view}
            onView={setView}
            stage={selected}
            label={selected ? stageLabel(setup.stages, selected.id) : ""}
            preview={selected ? previews.cards[selected.id] : undefined}
            run={run}
            onStop={stop}
            plan={explain.plan}
            onStopPlan={explain.stop}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <PasteDialog
        open={pasting}
        onOpenChange={setPasting}
        canAppend={can_append}
        onApply={onPaste}
      />
      <SwitchCollectionDialog
        to={
          switch_to &&
          (switch_to.database === database
            ? switch_to.collection
            : `${switch_to.database}.${switch_to.collection}`)
        }
        canSave={!WEB && ready}
        onCancel={() => setSwitchTo(null)}
        onDiscard={() => {
          if (switch_to) switchCollection(switch_to);
          setSwitchTo(null);
        }}
        onSave={async () => {
          const to = switch_to;
          if (to && (await file.save(false))) {
            switchCollection(to);
            setSwitchTo(null);
          }
        }}
      />
      {confirm.dialog}
    </div>
  );
}
