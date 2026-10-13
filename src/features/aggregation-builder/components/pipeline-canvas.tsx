import { useMemo, useRef, useState, type ReactNode } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { Download, Loader2, Plus, Workflow } from "lucide-react";
import {
  AddCard,
  AddMenuContext,
  BuilderFlow,
  InsertLink,
  MAIN_ADD,
  dragSlot,
  linkAt,
  useFitOnce,
  useNodeSizes,
  type AddCardNode,
  type AddMenu,
  type CardFault,
  type InsertEdge,
  type XY,
} from "@/shared/components/builder-canvas";
import { useStudioStore, type AggregationStage } from "@/shared/store";
import {
  DiagramEmpty,
  exportDiagram,
  type ExportFormat,
} from "@/shared/components/relation-canvas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import {
  CardActionsContext,
  FieldsContext,
  type CardActions,
} from "../lib/card-actions";
import { joinedCollection } from "../lib/fields";
import { addId, headId, joinId, pipelineLayout } from "../lib/layout";
import {
  allStages,
  chainOf,
  chainStages,
  isBranching,
  lastSlot,
  moveStage,
  type ChainRef,
} from "../lib/model";
import { isWriteOp } from "../lib/operators";
import type { CardPreview } from "../lib/use-previews";
import {
  BranchHead,
  JoinCard,
  SideLink,
  type BranchHeadNode,
  type JoinCardNode,
  type SideEdge,
} from "./branch-parts";
import { StageCard, type StageCardNode } from "./stage-card";
import { OperatorMenu } from "./operator-menu";
import { StagePalette, STAGE_MIME } from "./stage-palette";
import { Button } from "@/shared/components/ui/button";

type FlowNode = StageCardNode | AddCardNode | BranchHeadNode | JoinCardNode;
type FlowEdge = InsertEdge | SideEdge;

const nodeTypes = {
  stage: StageCard,
  add: AddCard,
  head: BranchHead,
  join: JoinCard,
};
const edgeTypes = { insert: InsertLink, side: SideLink };
const sameChain = (a: ChainRef, b: ChainRef) =>
  a === b || (!!a && !!b && a.parent === b.parent && a.key === b.key);

export interface PipelineCanvasProps {
  stages: AggregationStage[];
  selectedId: string | null;
  previews: Record<string, CardPreview>;
  faults: Record<string, CardFault>;
  /** The fields each card can pick from. */
  fields: Record<string, string[]>;
  cap: number;
  sampled: boolean;
  actions: CardActions;
  /** The tab's controls, floating top right on the canvas. */
  toolbar?: ReactNode;
  /** Undo and redo, on top of the zoom stack bottom left. */
  history?: ReactNode;
  /** The image export's file name, without the extension. */
  exportName: string;
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

/** A card being dragged: where it is now and the slot it would take in
 *  its chain. */
interface Drag {
  id: string;
  at: XY;
  slot: number;
}

/** Where a palette stage goes: a place in one chain. */
interface Drop {
  chain: ChainRef;
  index: number;
}

function CanvasInner({
  stages,
  selectedId,
  previews,
  faults,
  fields,
  cap,
  sampled,
  actions,
  toolbar,
  history,
  exportName,
}: PipelineCanvasProps) {
  const rf = useReactFlow<FlowNode>();
  const wrapper = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const { sizes, heights, onNodesChange } = useNodeSizes<FlowNode>();
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Where a palette stage held over the canvas would land. */
  const [drop, setDrop] = useState<Drop | null>(null);
  const settled = useMemo(
    () => pipelineLayout(stages, heights),
    [stages, heights],
  );
  const end = lastSlot(stages);

  // While a card is dragged the others in its chain make room at the slot
  // it would take.
  const shown = useMemo(
    () => (drag ? moveStage(stages, drag.id, drag.slot) : stages),
    [stages, drag],
  );

  const nodes = useMemo<FlowNode[]>(() => {
    const { at } = pipelineLayout(shown, heights);
    const measured = (id: string) => (sizes[id] ? { measured: sizes[id] } : {});
    const fixed = { selectable: false, draggable: false } as const;
    const dropping = (chain: ChainRef, index: number) =>
      !!drop && drop.index === index && sameChain(drop.chain, chain);
    const card = (
      stage: AggregationStage,
      ordinal: number,
      chain: ChainRef,
      label: string,
      last: boolean,
    ): StageCardNode => ({
      id: stage.id,
      type: "stage",
      position: drag?.id === stage.id ? drag.at : at[stage.id],
      selected: stage.id === selectedId,
      draggable: !isWriteOp(stage.op),
      // React Flow marks only draggable nodes nopan; without it the pane
      // swallows mousedown and the card's menus never open.
      className: isWriteOp(stage.op) ? "nopan" : undefined,
      dragHandle: ".stage-drag",
      ...measured(stage.id),
      data: {
        stage,
        ordinal,
        chain,
        label,
        preview: previews[stage.id],
        fault: faults[stage.id],
        last,
        cap,
        sampled,
      },
    });

    const out: FlowNode[] = [];
    shown.forEach((s, i) => {
      out.push(card(s, i + 1, null, `Stage ${i + 1}`, i === shown.length - 1));
      if (isBranching(s.op) && s.branches?.length) {
        for (const b of s.branches) {
          const ref = { parent: s.id, key: b.key };
          const head = headId(s.id, b.key);
          out.push({
            id: head,
            type: "head",
            position: at[head],
            ...fixed,
            ...measured(head),
            data: {
              parent: s.id,
              parentOrdinal: i + 1,
              op: s.op,
              key: b.key,
              others: s.branches.filter((x) => x !== b).map((x) => x.key),
              collection: joinedCollection(s),
            },
          });
          b.stages.forEach((c, j) =>
            out.push(
              card(
                c,
                j + 1,
                ref,
                `Stage ${j + 1} of ${b.key} in stage ${i + 1}`,
                false,
              ),
            ),
          );
          const add = addId(ref);
          out.push({
            id: add,
            type: "add",
            position: at[add],
            ...fixed,
            ...measured(add),
            data: {
              index: b.stages.length,
              chain: ref,
              active: dropping(ref, b.stages.length),
            },
          });
        }
      } else if (s.op === "$lookup") {
        const join = joinId(s.id);
        out.push({
          id: join,
          type: "join",
          position: at[join],
          ...fixed,
          ...measured(join),
          data: { body: s.body },
        });
      }
    });
    // Nothing goes after a stage that writes.
    const tail = shown.at(-1);
    if (tail && !isWriteOp(tail.op))
      out.push({
        id: MAIN_ADD,
        type: "add",
        position: at[MAIN_ADD],
        ...fixed,
        ...measured(MAIN_ADD),
        data: {
          index: shown.length,
          chain: null,
          active: dropping(null, shown.length),
        },
      });
    return out;
  }, [
    shown,
    heights,
    drag,
    selectedId,
    sizes,
    previews,
    faults,
    cap,
    sampled,
    drop,
  ]);

  const edges = useMemo<FlowEdge[]>(() => {
    const out: FlowEdge[] = [];
    const active = (chain: ChainRef, index: number) =>
      !!drop && drop.index === index && sameChain(drop.chain, chain);
    /** Links down one chain; `offset` is how many nodes come before its
     *  first card. A link into a card carries the "+" for that place. */
    const chainLinks = (
      ids: string[],
      chain: ChainRef,
      offset: number,
      plus: (k: number) => boolean,
    ) => {
      for (let k = 0; k + 1 < ids.length; k++) {
        const index = k + 1 - offset;
        out.push({
          id: `${ids[k]}->${ids[k + 1]}`,
          type: "insert",
          source: ids[k],
          target: ids[k + 1],
          selectable: false,
          focusable: false,
          ...(plus(k) && !drag
            ? { data: { index, chain, active: active(chain, index) } }
            : {}),
        });
      }
    };

    const tail = stages.at(-1);
    const main = stages.map((s) => s.id);
    if (tail && !isWriteOp(tail.op)) main.push(MAIN_ADD);
    chainLinks(
      main,
      null,
      0,
      (k) => k + 1 < stages.length && !isWriteOp(stages[k].op),
    );
    for (const s of stages) {
      const side = (target: string) =>
        out.push({
          id: `side:${target}`,
          type: "side",
          source: s.id,
          sourceHandle: "side",
          target,
          selectable: false,
          focusable: false,
        });
      if (isBranching(s.op) && s.branches?.length) {
        for (const b of s.branches) {
          const ref = { parent: s.id, key: b.key };
          const head = headId(s.id, b.key);
          side(head);
          const ids = [head, ...b.stages.map((c) => c.id), addId(ref)];
          chainLinks(ids, ref, 1, (k) => k < b.stages.length);
        }
      } else if (s.op === "$lookup") side(joinId(s.id));
    }
    return out;
  }, [stages, drag, drop]);

  /** The slot card `id` dragged to `at` takes in its own chain. */
  const slotFor = (id: string, at: XY) => {
    const ref = chainOf(stages, id);
    if (ref === undefined) return 0;
    const rest = chainStages(stages, ref).filter((s) => s.id !== id);
    const slot = dragSlot(
      rest.map((s) => s.id),
      settled.at,
      heights,
      at.y,
      heights[id] ?? 0,
    );
    return Math.min(slot, lastSlot(rest));
  };

  /** Where a palette stage dropped at this screen point goes: the link it
   *  is on in any chain, else the main chain's end; null when `op` cannot
   *  go there. A stage that writes only ever goes last on the main chain. */
  const dropAt = (
    op: string,
    clientX: number,
    clientY: number,
  ): Drop | null => {
    const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
    if (isWriteOp(op))
      return end === stages.length ? { chain: null, index: end } : null;
    for (const c of settled.chains) {
      const link = linkAt(c.ids, settled.at, heights, p, c.x);
      if (link === null) continue;
      // A side chain's ids start with its head.
      if (c.ref) return { chain: c.ref, index: link - 1 };
      if (link <= end) return { chain: null, index: link };
    }
    return { chain: null, index: end };
  };

  // Fit once the first cards have their real heights.
  useFitOnce(stages.length > 0 && allStages(stages).every((s) => sizes[s.id]));

  const addMenu = useMemo<AddMenu>(
    () => ({
      noun: "stage",
      render: (place, trigger, end) => (
        <OperatorMenu
          allowWrite={end && !place.chain}
          onPick={(op) =>
            actions.insert(place.index, op, (place.chain ?? null) as ChainRef)
          }
          trigger={trigger}
        />
      ),
    }),
    [actions],
  );

  const canAdd = (op: string) => !isWriteOp(op) || end === stages.length;

  const runExport = async (format: ExportFormat) => {
    const notify = useStudioStore.getState().pushNotification;
    setExporting(true);
    // Let the menu close before the cards are drawn.
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    try {
      const path = await exportDiagram(rf, wrapper.current, format, exportName);
      if (path)
        notify({
          kind: "success",
          title: `Pipeline exported as ${format.toUpperCase()}`,
          detail: path,
        });
    } catch (e) {
      notify({
        kind: "error",
        title: "Export failed",
        detail: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <CardActionsContext.Provider value={actions}>
      <AddMenuContext.Provider value={addMenu}>
        <FieldsContext.Provider value={fields}>
          <div
            ref={wrapper}
            className="relative h-full w-full"
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(STAGE_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              // The op is unreadable until the drop, so place it as a read stage.
              const at = dropAt("$match", e.clientX, e.clientY);
              if (
                at?.index !== drop?.index ||
                !sameChain(at?.chain ?? null, drop?.chain ?? null)
              )
                setDrop(at);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                setDrop(null);
            }}
            onDrop={(e) => {
              const op = e.dataTransfer.getData(STAGE_MIME);
              setDrop(null);
              if (!op) return;
              e.preventDefault();
              const at = dropAt(op, e.clientX, e.clientY);
              if (at) actions.insert(at.index, op, at.chain);
            }}
          >
            <BuilderFlow<FlowNode, FlowEdge>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(n) => {
                if (n.type === "stage") actions.select(n.id);
              }}
              onNodeDrag={(_, n) => {
                if (n.type !== "stage") return;
                setDrag({
                  id: n.id,
                  at: n.position,
                  slot: slotFor(n.id, n.position),
                });
              }}
              onNodeDragStop={(_, n) => {
                if (n.type !== "stage") return;
                const slot = slotFor(n.id, n.position);
                setDrag(null);
                actions.move(n.id, slot);
              }}
              label="Aggregation pipeline"
              empty={stages.length === 0}
              history={history}
              toolbar={
                toolbar && (
                  <>
                    {toolbar}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="iconXs"
                            aria-label="Export image"
                            title="Export the canvas as an image"
                            disabled={stages.length === 0 || exporting}
                          >
                            {exporting ? (
                              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                            ) : (
                              <Download className="size-3.5" />
                            )}
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => void runExport("png")}>
                          PNG image
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => void runExport("svg")}>
                          SVG image
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )
              }
            />
            <StagePalette
              canAdd={canAdd}
              onAdd={(op) => actions.insert(end, op)}
            />
            {stages.length === 0 && (
              <DiagramEmpty
                title="Build a pipeline"
                icon={<Workflow className="text-muted-foreground size-6" />}
                description="Add a first stage, or drag one from the palette. Every stage shows what it puts out, run on the first documents of the collection."
              >
                <OperatorMenu
                  allowWrite
                  onPick={(op) => actions.insert(0, op)}
                  trigger={
                    <Button size="sm">
                      <Plus className="size-3.5" />
                      Add first stage
                    </Button>
                  }
                />
              </DiagramEmpty>
            )}
          </div>
        </FieldsContext.Provider>
      </AddMenuContext.Provider>
    </CardActionsContext.Provider>
  );
}
