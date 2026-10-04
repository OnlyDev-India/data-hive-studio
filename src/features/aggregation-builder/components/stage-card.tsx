import { memo, useMemo, useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertCircle,
  Braces,
  ChevronDown,
  ChevronRight,
  Clock,
  CopyPlus,
  Eye,
  EyeOff,
  GripVertical,
  ListChecks,
  Loader2,
  MoreHorizontal,
  PenLine,
  Plus,
  StickyNote,
  Trash2,
  Type,
} from "lucide-react";
import type { AggregationStage } from "@/shared/store";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Switch } from "@/shared/components/ui/switch";
import { BsonEditor } from "@/shared/components/query-editor/bson-json-editor";
import { cn } from "@/shared/lib/utils";
import { useCardActions, useCardFields } from "../lib/card-actions";
import type { CardFault } from "../lib/card-state";
import { fieldCompletions } from "../lib/field-completions";
import { countLabel, docLine, docText } from "../lib/format";
import { hasForm } from "../lib/forms";
import { CARD_WIDTH } from "../lib/layout";
import type { ChainRef } from "../lib/model";
import { isWriteOp, operatorOf } from "../lib/operators";
import type { CardPreview } from "../lib/use-previews";
import { OperatorMenu } from "./operator-menu";
import { StageForm } from "./stage-form";

export interface StageCardData extends Record<string, unknown> {
  stage: AggregationStage;
  /** 1 based place in its chain. */
  ordinal: number;
  /** Its chain, null for the main one. */
  chain: ChainRef;
  /** "Stage 3", or "Stage 2 of output in stage 3" in a side chain. */
  label: string;
  preview: CardPreview | undefined;
  fault: CardFault | undefined;
  /** The chain's last card, the only place a write stage can go. */
  last: boolean;
  cap: number;
  sampled: boolean;
}

export type StageCardNode = Node<StageCardData, "stage">;

const HIDDEN_HANDLE = "pointer-events-none opacity-0!";

export const StageCard = memo(function StageCard({
  data,
  selected,
  dragging,
}: NodeProps<StageCardNode>) {
  const { stage, ordinal, chain, label, preview, fault, last, cap, sampled } =
    data;
  const actions = useCardActions();
  const fields = useCardFields(stage.id);
  // Keyed on the names, so a refresh with the same fields keeps the editor.
  const field_key = fields.join("\n");
  const completions = useMemo(
    () => [fieldCompletions(field_key ? field_key.split("\n") : [])],
    [field_key],
  );
  const error = stage.enabled ? fault?.error : undefined;
  const writes = isWriteOp(stage.op);
  const form = stage.view === "form" && hasForm(stage.op);
  return (
    <div
      style={{ width: CARD_WIDTH }}
      aria-label={`${label}, ${stage.op}${stage.enabled ? "" : ", disabled"}`}
      className={cn(
        "bg-card text-card-foreground rounded-surface border shadow-xs transition-shadow",
        selected && "ring-ring/60 ring-2",
        error && "border-destructive/50",
        !stage.enabled && "border-dashed",
        dragging && "shadow-lg",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <div
        className={cn(
          "flex items-center gap-1 py-1 pr-1 pl-1",
          !stage.collapsed && "border-b",
        )}
      >
        <span
          className={cn(
            "text-muted-foreground flex items-center",
            writes ? "opacity-30" : "stage-drag cursor-grab",
          )}
          title={writes ? "A stage that writes stays last" : "Drag to move"}
        >
          <GripVertical className="size-3.5" />
        </span>
        <span className="text-muted-foreground text-caption w-4 text-right tabular-nums">
          {ordinal}
        </span>
        <OperatorMenu
          current={stage.op}
          allowWrite={last}
          onPick={(op) => actions.setOp(stage.id, op)}
          trigger={
            <Button
              variant="ghost"
              size="sm"
              className="nodrag text-body gap-1 px-1.5 font-mono font-semibold"
              title={operatorOf(stage.op)?.description ?? "Change the operator"}
            >
              {stage.op}
              <ChevronDown className="text-muted-foreground size-3" />
            </Button>
          }
        />
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {stage.enabled ? (
            <PreviewStatus
              op={stage.op}
              preview={preview}
              fault={fault}
              cap={cap}
              sampled={sampled}
            />
          ) : (
            <Badge variant="muted" title="Left out of previews, Run and Copy">
              Disabled
            </Badge>
          )}
          {hasForm(stage.op) && !stage.collapsed && (
            <Button
              variant="ghost"
              size="iconXs"
              className="nodrag text-muted-foreground"
              aria-label={form ? "Edit as JSON" : "Edit as form"}
              title={form ? "Edit as JSON" : "Edit as form"}
              onClick={() =>
                actions.setFlags(stage.id, { view: form ? "json" : "form" })
              }
            >
              {form ? (
                <Braces className="size-3.5" />
              ) : (
                <ListChecks className="size-3.5" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="iconXs"
            className="nodrag text-muted-foreground"
            aria-label={stage.collapsed ? "Expand stage" : "Collapse stage"}
            aria-expanded={!stage.collapsed}
            title={stage.collapsed ? "Expand" : "Collapse"}
            onClick={() =>
              actions.setFlags(stage.id, { collapsed: !stage.collapsed })
            }
          >
            {stage.collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </Button>
          <CardMenu stage={stage} label={label} writes={writes} />
        </div>
      </div>
      {stage.title !== null && (
        <input
          aria-label={`${label} title`}
          value={stage.title}
          placeholder="Title"
          autoFocus={stage.title === ""}
          onChange={(e) => actions.setText(stage.id, "title", e.target.value)}
          onBlur={actions.commitText}
          className={cn(
            "nodrag text-body placeholder:text-muted-foreground w-full bg-transparent px-3 pt-1.5 font-medium outline-none",
            stage.collapsed && "pb-1.5",
          )}
        />
      )}
      {!stage.collapsed && (
        <>
          {stage.note !== null && (
            <textarea
              aria-label={`${label} note`}
              value={stage.note}
              placeholder="A note on this stage"
              rows={Math.min(4, stage.note.split("\n").length)}
              autoFocus={stage.note === ""}
              onChange={(e) =>
                actions.setText(stage.id, "note", e.target.value)
              }
              onBlur={actions.commitText}
              className="nodrag nowheel text-small text-muted-foreground placeholder:text-muted-foreground/70 w-full resize-none bg-transparent px-3 pt-1.5 outline-none"
            />
          )}
          <div
            className={cn(
              "nodrag nowheel nopan p-2",
              !form && "cursor-text",
              !stage.enabled && "opacity-60",
            )}
          >
            {form ? (
              <StageForm key={stage.op} stage={stage} />
            ) : (
              <BsonEditor
                value={stage.body}
                onChange={(v) => actions.setBody(stage.id, v)}
                onBlur={actions.commitText}
                compact
                minHeight="2.25rem"
                lineNumbers={false}
                disableLint
                extraExtensions={completions}
              />
            )}
          </div>
          {!chain && <SideChainRow stage={stage} />}
        </>
      )}
      {stage.enabled && (
        <CardFooter op={stage.op} preview={preview} fault={fault} />
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      {!chain && (
        <Handle
          id="side"
          type="source"
          position={Position.Right}
          isConnectable={false}
          className={HIDDEN_HANDLE}
        />
      )}
    </div>
  );
});

/** A main chain `$facet`'s outputs, or a `$lookup`'s sub pipeline switch. */
function SideChainRow({ stage }: { stage: AggregationStage }) {
  const actions = useCardActions();
  if (stage.op === "$facet") {
    const n = stage.branches?.length ?? 0;
    return (
      <div className="text-small text-muted-foreground flex items-center gap-2 border-t py-1 pr-1 pl-3">
        {n === 1 ? "1 output" : `${n} outputs`}, each a side chain
        <Button
          variant="ghost"
          size="sm"
          className="nodrag ml-auto px-2"
          onClick={() => actions.addBranch(stage.id)}
        >
          <Plus className="size-3" />
          Add output
        </Button>
      </div>
    );
  }
  if (stage.op !== "$lookup") return null;
  const on = !!stage.branches?.length;
  return (
    <label className="nodrag text-small text-muted-foreground flex items-center gap-2 border-t px-3 py-1.5">
      <Switch
        checked={on}
        onCheckedChange={(v) => actions.setSubPipeline(stage.id, v)}
      />
      Sub pipeline
      <span className="text-caption truncate">
        {on
          ? "run on the joined collection, as a side chain"
          : "join on two fields only"}
      </span>
    </label>
  );
}

function CardMenu({
  stage,
  label,
  writes,
}: {
  stage: AggregationStage;
  label: string;
  writes: boolean;
}) {
  const actions = useCardActions();
  const id = stage.id;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="iconXs"
            className="nodrag text-muted-foreground"
            aria-label={`${label} actions`}
            title="More"
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onClick={() => actions.setFlags(id, { enabled: !stage.enabled })}
        >
          {stage.enabled ? <EyeOff /> : <Eye />}
          {stage.enabled ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            actions.setText(id, "title", stage.title === null ? "" : null);
            actions.commitText();
          }}
        >
          <Type />
          {stage.title === null ? "Add title" : "Remove title"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            actions.setText(id, "note", stage.note === null ? "" : null);
            if (stage.note === null && stage.collapsed)
              actions.setFlags(id, { collapsed: false });
            actions.commitText();
          }}
        >
          <StickyNote />
          {stage.note === null ? "Add note" : "Remove note"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={writes}
          onClick={() => actions.duplicate(id)}
        >
          <CopyPlus />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => actions.remove(id)}
        >
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PreviewStatus({
  op,
  preview,
  fault,
  cap,
  sampled,
}: {
  op: string;
  preview: CardPreview | undefined;
  fault: CardFault | undefined;
  cap: number;
  sampled: boolean;
}) {
  if (isWriteOp(op))
    return (
      <Badge variant="warning" title="A stage that writes is never previewed">
        <PenLine />
        Writes
      </Badge>
    );
  if (fault?.timed_out)
    return (
      <Badge variant="warning">
        <Clock />
        Timed out
      </Badge>
    );
  if (fault?.error)
    return (
      <Badge variant="destructive">
        <AlertCircle />
        Error
      </Badge>
    );
  if (!preview) return null;
  const chunk = preview.chunk;
  const offline = preview.status === "offline";
  const held = !!fault?.blocked_by || preview.status === "waiting" || offline;
  return (
    <span
      className={cn(
        "text-small text-muted-foreground flex items-center gap-1.5 truncate tabular-nums",
        held && "opacity-50",
      )}
    >
      {offline && (
        <Badge variant="muted" title="Previews resume once the server answers">
          Not connected
        </Badge>
      )}
      {preview.status === "running" && !held && (
        <Loader2
          aria-label="Previewing"
          className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
        />
      )}
      {chunk && !chunk.error && (
        <span
          title={`${chunk.count.toLocaleString()} documents out, in ${chunk.elapsed_ms} ms`}
        >
          {countLabel(chunk.count, cap, sampled)}
        </span>
      )}
      {sampled && chunk && !chunk.error && (
        <Badge
          variant="muted"
          title={`Previews read the first ${cap.toLocaleString()} documents of the collection. Run gives the exact result.`}
        >
          sampled
        </Badge>
      )}
    </span>
  );
}

function CardFooter({
  op,
  preview,
  fault,
}: {
  op: string;
  preview: CardPreview | undefined;
  fault: CardFault | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (fault?.error)
    return (
      <p
        role="alert"
        className={cn(
          "text-small border-t px-3 py-1.5 font-mono whitespace-pre-wrap",
          fault.timed_out ? "text-warning" : "text-destructive",
        )}
      >
        {fault.error}
        {fault.timed_out &&
          ". Raise the limit in the builder settings, or narrow an earlier stage."}
      </p>
    );
  if (isWriteOp(op))
    return (
      <p className="text-muted-foreground text-small border-t px-3 py-1.5">
        Runs only with Run, never in a preview.
      </p>
    );
  const blocked = fault?.blocked_by;
  const offline = preview?.status === "offline";
  const waiting = (blocked || preview?.status === "waiting" || offline) && (
    <p className="text-muted-foreground text-small flex items-center gap-1.5 border-t px-3 py-1.5">
      <Clock className="size-3" />
      {blocked
        ? `Waiting on ${blocked}`
        : offline
          ? "Not connected, showing the last preview"
          : "Waiting on an earlier stage"}
    </p>
  );
  const first = preview?.chunk?.documents[0];
  if (!preview?.chunk || preview.chunk.error) return waiting || null;
  if (first === undefined)
    return (
      <>
        {waiting}
        <p
          className={cn(
            "text-muted-foreground text-small border-t px-3 py-1.5",
            waiting && "opacity-50",
          )}
        >
          No documents come out of this stage.
        </p>
      </>
    );
  return (
    <>
      {waiting}
      <div
        className={cn(
          "border-t",
          waiting ? "opacity-50" : preview.status === "running" && "opacity-60",
        )}
      >
        <button
          type="button"
          className="nodrag text-small hover:bg-muted/60 rounded-b-surface flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-left"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? (
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3 shrink-0" />
          )}
          <span className="text-muted-foreground truncate font-mono">
            {docLine(first)}
          </span>
        </button>
        {open && (
          <pre className="nodrag nowheel text-small max-h-64 overflow-auto px-3 pb-2 font-mono whitespace-pre select-text">
            {docText(first)}
          </pre>
        )}
      </div>
    </>
  );
}
