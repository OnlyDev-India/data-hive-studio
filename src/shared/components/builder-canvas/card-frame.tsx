import { useState, type ReactNode } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
} from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import type { CardFault } from "./card-state";
import { countLabel } from "./format";
import { CARD_WIDTH } from "./layout";
import type { CardPreview, ChunkBase } from "./use-preview-scheduler";

const HIDDEN_HANDLE = "pointer-events-none opacity-0!";

/** A card's box on the canvas, with the hidden handles its links attach to. */
export function CardFrame({
  label,
  selected,
  dragging,
  error,
  dashed,
  sideHandle,
  children,
}: {
  label: string;
  selected: boolean;
  dragging: boolean;
  error: boolean;
  dashed?: boolean;
  /** A handle on the right for a link to a side chain. */
  sideHandle?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{ width: CARD_WIDTH }}
      aria-label={label}
      className={cn(
        "bg-card text-card-foreground rounded-surface border shadow-xs transition-shadow",
        selected && "ring-ring/60 ring-2",
        error && "border-destructive/50",
        dashed && "border-dashed",
        dragging && "shadow-lg",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      {children}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={HIDDEN_HANDLE}
      />
      {sideHandle && (
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
}

/** The header's status: error or time limit, else the count of what came
 *  out, the sampled badge, and a spinner while it refreshes. */
export function PreviewStatus<C extends ChunkBase>({
  preview,
  fault,
  cap,
  sampled,
  noun,
  source,
}: {
  preview: CardPreview<C> | undefined;
  fault: CardFault | undefined;
  cap: number;
  sampled: boolean;
  /** "documents" or "rows". */
  noun: string;
  /** What previews read, such as "documents of the collection". */
  source: string;
}) {
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
          title={`${chunk.count.toLocaleString()} ${noun} out, in ${chunk.elapsed_ms} ms`}
        >
          {countLabel(chunk.count, cap, sampled)}
        </span>
      )}
      {sampled && chunk && !chunk.error && (
        <Badge
          variant="muted"
          title={`Previews read the first ${cap.toLocaleString()} ${source}. Run gives the exact result.`}
        >
          sampled
        </Badge>
      )}
    </span>
  );
}

/** Under the card: its error, what it waits on, and its first row,
 *  collapsed to one line. */
export function CardFooter<C extends ChunkBase>({
  preview,
  fault,
  firstRow,
  empty,
  earlier,
  timeoutHint,
}: {
  preview: CardPreview<C> | undefined;
  fault: CardFault | undefined;
  /** The first row as one line and in full, null when nothing came out. */
  firstRow: (chunk: C) => { line: string; text: string } | null;
  /** Said when nothing comes out of the card. */
  empty: string;
  /** Said while an earlier card holds this one, such as "Waiting on an
   *  earlier stage". */
  earlier: string;
  /** Added to a time limit error. */
  timeoutHint: string;
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
        {fault.timed_out && timeoutHint}
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
          : earlier}
    </p>
  );
  if (!preview?.chunk || preview.chunk.error) return waiting || null;
  const first = firstRow(preview.chunk);
  if (!first)
    return (
      <>
        {waiting}
        <p
          className={cn(
            "text-muted-foreground text-small border-t px-3 py-1.5",
            waiting && "opacity-50",
          )}
        >
          {empty}
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
            {first.line}
          </span>
        </button>
        {open && (
          <pre className="nodrag nowheel text-small max-h-64 overflow-auto px-3 pb-2 font-mono whitespace-pre select-text">
            {first.text}
          </pre>
        )}
      </div>
    </>
  );
}
