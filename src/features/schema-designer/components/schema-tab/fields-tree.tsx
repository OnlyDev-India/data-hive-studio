import { useState } from "react";
import { AlertCircle, Braces, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import type { FieldShape } from "@/shared/api";

const INDENT_PX = 16;

/** Read only "Fields" view (spec 0001): a MongoDB collection's inferred
 *  nested shape, replacing the old flat "Inferred fields" table in
 *  `MongoSchemaView`. Pure/presentational — the fetch, its loading and
 *  error state, and the lazy/cached trigger all live in the caller
 *  (`mongo-collection-pane.tsx`), matching how it already owns the
 *  `table_schema` fetch for `MongoSchemaEditor`. */
export function FieldsTree({
  fields,
  loading,
  error,
}: {
  fields: FieldShape[] | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="bg-background rounded-md border">
      <div className="border-b px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Braces className="text-muted-foreground h-4 w-4" />
          <span>Fields</span>
        </h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Sampled from the first 200 documents (Mongo is schemaless).
        </p>
      </div>
      {error ? (
        <div className="flex items-center gap-2 px-3 py-3 text-sm">
          <AlertCircle
            className="text-destructive size-4 shrink-0"
            aria-hidden
          />
          <span className="text-destructive">
            Could not load fields: {error}
          </span>
        </div>
      ) : loading && !fields ? (
        <div className="text-muted-foreground px-3 py-3 text-sm">
          Loading fields…
        </div>
      ) : !fields || fields.length === 0 ? (
        <div className="text-muted-foreground px-3 py-3 text-sm">
          No fields found.
        </div>
      ) : (
        <div>
          {fields.map((f) => (
            <FieldRow key={f.path} field={f} depth={0} />
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({ field, depth }: { field: FieldShape; depth: number }) {
  const children = field.children ?? [];
  const has_children = children.length > 0;
  // Root plus one level expanded by default (depth 0 = a top-level field),
  // so its direct children are visible without a click, nothing deeper.
  const [open, setOpen] = useState(depth < 1);
  const hidden_count =
    field.truncated && field.truncated.total > field.truncated.shown
      ? field.truncated.total - field.truncated.shown
      : 0;

  return (
    <div>
      <div
        className="hover:bg-muted/40 flex items-center gap-1.5 border-b px-3 py-1.5 text-sm last:border-0"
        style={{ paddingLeft: 12 + depth * INDENT_PX }}
      >
        {has_children ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={
              open ? `Collapse ${field.name}` : `Expand ${field.name}`
            }
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            {open ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="inline-block size-3.5 shrink-0" aria-hidden />
        )}
        <span className="font-mono">{field.name}</span>
        <span className="text-muted-foreground text-xs">
          {field.type}
          {field.type === "array" && field.element_types?.length
            ? ` — ${field.element_types.join(" | ")}`
            : ""}
          {field.empty ? " (empty)" : ""}
        </span>
        {field.optional && <Badge variant="outline">optional</Badge>}
        {hidden_count > 0 && (
          <Badge variant="muted">+{hidden_count} more</Badge>
        )}
        {field.depth_truncated && <Badge variant="muted">depth limit</Badge>}
      </div>
      {has_children && open && (
        <div>
          {children.map((c) => (
            <FieldRow key={c.path} field={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
