import { useId, type ReactNode } from "react";
import { Loader2, Network, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { GraphEntry } from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui/switch";
import { CanvasButton } from "./canvas-button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";

/** What the canvas shows over itself instead of, or on top of, a graph. */
export type CanvasState =
  | { kind: "loading"; label?: string }
  | { kind: "error"; message?: string; onRetry: () => void }
  | { kind: "empty"; title: string };

/** Centered over the canvas; only the message itself takes the pointer, so
 *  the canvas around it still pans. */
export function DiagramOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="pointer-events-auto">{children}</div>
    </div>
  );
}

export function StateOverlay({ state }: { state: CanvasState }) {
  if (state.kind === "loading")
    return (
      <DiagramOverlay>
        <p
          role="status"
          className="text-muted-foreground text-body flex items-center gap-2"
        >
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          {state.label ?? "Reading the catalog…"}
        </p>
      </DiagramOverlay>
    );
  if (state.kind === "error")
    return (
      <DiagramOverlay>
        <Empty className="border-none">
          <EmptyHeader>
            <TriangleAlert className="text-destructive size-6" />
            <EmptyTitle>Couldn't load the diagram</EmptyTitle>
            <EmptyDescription role="alert">{state.message}</EmptyDescription>
          </EmptyHeader>
          <Button size="sm" variant="outline" onClick={state.onRetry}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </Empty>
      </DiagramOverlay>
    );
  return <DiagramEmpty title={state.title} />;
}

/** An empty state message over the canvas, with optional controls. */
export function DiagramEmpty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <DiagramOverlay>
      <Empty className="border-none">
        <EmptyHeader>
          <Network className="text-muted-foreground size-6" />
          <EmptyTitle>{title}</EmptyTitle>
          {description && <EmptyDescription>{description}</EmptyDescription>}
        </EmptyHeader>
        {children}
      </Empty>
    </DiagramOverlay>
  );
}

/** The Refresh button every diagram view carries. */
export function RefreshButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <CanvasButton
      onClick={onClick}
      title="Read the diagram from the database again"
      label="Refresh"
      shrink={1}
      icon={
        loading ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : (
          <RefreshCw className="size-3.5" />
        )
      }
    />
  );
}

/** "N of M sampled" with Cancel while a Mongo sample is running. */
export function SampleProgress({
  entry,
  onCancel,
}: {
  entry: GraphEntry | undefined;
  onCancel: () => void;
}) {
  if (!entry || (entry.status !== "loading" && entry.status !== "partial"))
    return null;
  return (
    <span
      role="status"
      className="text-muted-foreground text-small flex items-center gap-1.5"
    >
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
      {entry.total == null
        ? "Listing collections…"
        : `${entry.sampled ?? 0} of ${entry.total} sampled`}
      <CanvasButton
        onClick={onCancel}
        title="Stop sampling and keep what has loaded"
        label="Cancel"
        shrink={0}
        icon={<X className="size-3.5" />}
      />
    </span>
  );
}

export function InferredToggle({
  hidden,
  onChange,
  disabled = false,
}: {
  hidden: boolean;
  onChange: (hidden: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div
      className="flex items-center gap-1.5"
      title="Links guessed from field names and ObjectId values"
    >
      <Switch
        id={id}
        checked={!hidden}
        disabled={disabled}
        onCheckedChange={(on) => onChange(!on)}
        className="h-4 w-8 [&>span]:size-3"
      />
      <Label
        htmlFor={id}
        className="text-muted-foreground text-small font-normal"
      >
        Inferred links
      </Label>
    </div>
  );
}
