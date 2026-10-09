import { useState } from "react";
import type { BuilderQuery } from "@/shared/store";
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
import { parseStatements } from "../lib/parse-back";
import type { Dialect } from "../lib/sql-text";

/** Paste SQL to add each statement as a new query after the last one,
 *  as cards where they fit and as SQL statements where not. */
export function PasteDialog({
  open,
  onOpenChange,
  dialect,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dialect: Dialect;
  onApply: (queries: BuilderQuery[]) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const queries = parseStatements(text, dialect);
    if (queries.length === 0) {
      setError("There is no statement to add, only comments.");
      return;
    }
    onApply(queries);
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
            Each statement becomes a new query after the last one. A{" "}
            <code className="font-mono">-- name: …</code> line above a statement
            names it.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label="SQL to add as queries"
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
            Add queries
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
