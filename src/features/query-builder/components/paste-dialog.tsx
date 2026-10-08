import { useState } from "react";
import type { Clause } from "@/shared/store";
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
import { parseBack } from "../lib/parse-back";
import type { Dialect } from "../lib/sql-text";

/** Paste a SELECT to replace the cards. A query the cards can't hold says
 *  why and changes nothing. */
export function PasteDialog({
  open,
  onOpenChange,
  dialect,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialect: Dialect;
  onApply: (clauses: Clause[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const r = parseBack(text, dialect);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onApply(r.clauses);
    setText("");
    setError(null);
    onOpenChange(false);
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
          <DialogTitle>Paste SQL</DialogTitle>
          <DialogDescription>
            One SELECT. Its clauses replace the cards on the canvas.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="SELECT to open as cards"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="SELECT c.country, COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id GROUP BY c.country"
          className="text-small min-h-48 font-mono"
          autoFocus
        />
        {error && (
          <p role="alert" className="text-destructive text-small">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!text.trim()}>
            Replace cards
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
