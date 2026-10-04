import { useState } from "react";
import { parsePipeline } from "@/shared/api";
import type { AggregationStage } from "@/shared/store";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { stagesFromDrafts } from "../lib/model";

export type PasteMode = "replace" | "append";

/** Paste shell or JSON pipeline text as cards. Text that does not parse
 *  shows why and changes nothing. */
export function PasteDialog({
  open,
  onOpenChange,
  canAppend,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False when the pipeline ends in a stage that writes. */
  canAppend: boolean;
  onApply: (stages: AggregationStage[], mode: PasteMode) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async (mode: PasteMode) => {
    setBusy(true);
    try {
      const parsed = await parsePipeline(text);
      onApply(stagesFromDrafts(parsed.stages), mode);
      setText("");
      setError(null);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste pipeline</DialogTitle>
          <DialogDescription>
            Paste a shell call such as db.orders.aggregate([...]) or a JSON
            array of stages. Each stage becomes a card.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="Pipeline text"
          aria-invalid={!!error}
          aria-describedby={error ? "paste-error" : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          spellCheck={false}
          autoFocus
          className="text-small h-64 resize-none font-mono"
          placeholder={'[{ $match: { status: "A" } }, { $limit: 10 }]'}
        />
        {error && (
          <p
            id="paste-error"
            role="alert"
            className="text-destructive text-small whitespace-pre-wrap"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || !text.trim() || !canAppend}
            title={
              canAppend
                ? "Add the stages after the last card"
                : "Nothing can go after a stage that writes"
            }
            onClick={() => void apply("append")}
          >
            Append
          </Button>
          <Button
            disabled={busy || !text.trim()}
            onClick={() => void apply("replace")}
          >
            Replace cards
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
