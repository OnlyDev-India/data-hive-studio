import { memo, useState } from "react";
import {
  BaseEdge,
  getSmoothStepPath,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { GitMerge, Split, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useCardActions } from "../lib/card-actions";
import { bodyString } from "../lib/fields";
import { CARD_WIDTH } from "../lib/layout";
import { facetKeyError } from "../lib/model";

const HIDDEN_HANDLE = "pointer-events-none opacity-0!";

export interface BranchHeadData extends Record<string, unknown> {
  parent: string;
  /** The parent's 1 based place in the main chain. */
  parentOrdinal: number;
  op: string;
  key: string;
  /** The other outputs of the same `$facet`. */
  others: string[];
  /** The collection a `$lookup` or `$unionWith` side chain reads. */
  collection: string | null;
}

export type BranchHeadNode = Node<BranchHeadData, "head">;

/** The top of a side chain: a `$facet` output's name, editable, or the
 *  pipeline a `$lookup` or `$unionWith` runs on another collection. */
export const BranchHead = memo(function BranchHead({
  data,
}: NodeProps<BranchHeadNode>) {
  const { parent, parentOrdinal, op, key, others, collection } = data;
  const actions = useCardActions();
  const facet = op === "$facet";
  return (
    <div
      style={{ width: CARD_WIDTH }}
      className="bg-muted/60 rounded-control text-small flex min-h-8 items-center gap-1.5 border border-dashed py-0.5 pr-1 pl-2"
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      {facet ? (
        <Split className="text-muted-foreground size-3.5 shrink-0" />
      ) : (
        <GitMerge className="text-muted-foreground size-3.5 shrink-0" />
      )}
      {facet ? (
        <OutputName
          parent={parent}
          parentOrdinal={parentOrdinal}
          value={key}
          others={others}
        />
      ) : (
        <span className="text-muted-foreground min-w-0 truncate">
          <span className="text-foreground font-mono">pipeline</span>
          {op === "$lookup" ? " joined from " : " run on "}
          <span className="text-foreground font-mono">{collection ?? "?"}</span>
        </span>
      )}
      {facet && (
        <Button
          variant="ghost"
          size="iconXs"
          className="nodrag text-muted-foreground ml-auto"
          disabled={others.length === 0}
          aria-label={`Remove output ${key}`}
          title={
            others.length === 0
              ? "A $facet keeps at least one output"
              : "Remove this output and its stages"
          }
          onClick={() => actions.removeBranch(parent, key)}
        >
          <X className="size-3.5" />
        </Button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
    </div>
  );
});

/** A `$facet` output name, saved on Enter or blur once it is a valid name;
 *  Escape puts the old one back. */
function OutputName({
  parent,
  parentOrdinal,
  value,
  others,
}: {
  parent: string;
  parentOrdinal: number;
  value: string;
  others: string[];
}) {
  const actions = useCardActions();
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value;
  const error = draft === null ? null : facetKeyError(draft.trim(), others);
  const commit = () => {
    if (draft !== null && !error && draft.trim() !== value)
      actions.renameBranch(parent, value, draft.trim());
    setDraft(null);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <input
        aria-label={`Output name in stage ${parentOrdinal}`}
        aria-invalid={!!error}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "nodrag rounded-inset focus-visible:bg-background min-w-0 bg-transparent px-1 font-mono outline-none",
          error && "text-destructive",
        )}
      />
      {error && (
        <span role="alert" className="text-destructive text-caption px-1">
          {error}
        </span>
      )}
    </div>
  );
}

export interface JoinCardData extends Record<string, unknown> {
  body: string;
}

export type JoinCardNode = Node<JoinCardData, "join">;

/** A simple `$lookup` beside its card: the joined collection and the two
 *  join fields. */
export const JoinCard = memo(function JoinCard({
  data,
}: NodeProps<JoinCardNode>) {
  const read = (k: string) => bodyString(data.body, k);
  const from = read("from");
  const local = read("localField");
  const foreign = read("foreignField");
  const as = read("as");
  return (
    <div
      style={{ width: CARD_WIDTH * 0.75 }}
      className="bg-card rounded-control text-small flex flex-col gap-0.5 border border-dashed px-2.5 py-1.5"
      aria-label={`Joins ${from ?? "a collection"}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      <span className="text-muted-foreground flex items-center gap-1.5">
        <GitMerge className="size-3.5 shrink-0" />
        Joins
        <span className="text-foreground truncate font-mono">
          {from || "?"}
        </span>
      </span>
      <span className="truncate font-mono">
        {local || "?"}
        <span className="text-muted-foreground"> = </span>
        {foreign || "?"}
      </span>
      {as && (
        <span className="text-muted-foreground truncate">
          into <span className="text-foreground font-mono">{as}</span>
        </span>
      )}
    </div>
  );
});

export type SideEdge = Edge<Record<string, unknown>, "side">;

/** The link from a parent card to one of its side chains. */
export const SideLink = memo(function SideLink({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<SideEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });
  return (
    <BaseEdge
      id={id}
      path={path}
      className="stroke-border! [stroke-dasharray:4_3]"
    />
  );
});
