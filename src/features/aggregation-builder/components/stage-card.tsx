import { memo, useMemo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Eye,
  EyeOff,
  GripVertical,
  ListChecks,
  MoreHorizontal,
  PenLine,
  Plus,
  StickyNote,
  Trash2,
  Type,
} from "lucide-react";
import type { PreviewChunk } from "@/shared/api";
import {
  CardFooter as SharedCardFooter,
  CardFrame,
  PreviewStatus as SharedPreviewStatus,
  type CardFault,
} from "@/shared/components/builder-canvas";
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
import { fieldCompletions } from "../lib/field-completions";
import { docLine, docText } from "../lib/format";
import { hasForm } from "../lib/forms";
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
    <CardFrame
      label={`${label}, ${stage.op}${stage.enabled ? "" : ", disabled"}`}
      selected={!!selected}
      dragging={!!dragging}
      error={!!error}
      dashed={!stage.enabled}
      sideHandle={!chain}
    >
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
    </CardFrame>
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
  return (
    <SharedPreviewStatus
      preview={preview}
      fault={fault}
      cap={cap}
      sampled={sampled}
      noun="documents"
      source="documents of the collection"
    />
  );
}

const firstDocument = (chunk: PreviewChunk) => {
  const first = chunk.documents[0];
  return first === undefined
    ? null
    : { line: docLine(first), text: docText(first) };
};

function CardFooter({
  op,
  preview,
  fault,
}: {
  op: string;
  preview: CardPreview | undefined;
  fault: CardFault | undefined;
}) {
  if (isWriteOp(op) && !fault?.error)
    return (
      <p className="text-muted-foreground text-small border-t px-3 py-1.5">
        Runs only with Run, never in a preview.
      </p>
    );
  return (
    <SharedCardFooter
      preview={preview}
      fault={fault}
      firstRow={firstDocument}
      empty="No documents come out of this stage."
      earlier="Waiting on an earlier stage"
      timeoutHint=". Raise the limit in the builder settings, or narrow an earlier stage."
    />
  );
}
