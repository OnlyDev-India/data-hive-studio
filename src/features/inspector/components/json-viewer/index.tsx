import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Braces } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import { TreeControls } from "./tree-controls";
import { BsonEditor } from "@/features/table-explorer/components/bson-json-editor";
import {
  parseMongoJson,
  renderMongoDocument,
  rowToDocument,
  valueToCell,
  type MongoJsonValue,
} from "@/shared/mongo-json";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import { Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";

const layoutTransition: Transition = { duration: 0.3, ease: "easeInOut" };

// ---- Search-match highlighting: matches are found in React state (below)
// and pushed into the editor as decorations via this field, since CodeMirror
// owns the live document text while the user types. ----
const setSearchMatches = StateEffect.define<{
  ranges: { from: number; to: number }[];
  active: number;
}>();

const searchMatchField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchMatches)) {
        const builder = new RangeSetBuilder<Decoration>();
        e.value.ranges.forEach((r, i) => {
          if (r.to <= r.from) return;
          builder.add(
            r.from,
            r.to,
            Decoration.mark({
              class: i === e.value.active ? "cm-search-match-active" : "cm-search-match",
            }),
          );
        });
        return builder.finish();
      }
    }
    return tr.docChanged ? deco.map(tr.changes) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const searchMatchTheme = EditorView.baseTheme({
  ".cm-search-match": { backgroundColor: "var(--warning-light)" },
  ".cm-search-match-active": {
    backgroundColor: "var(--warning)",
    color: "var(--warning-foreground)",
    borderRadius: "2px",
  },
});

/** Convert an edited top-level JSON value to the grid's flat cell string. */
function sqlCell(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/** The selected grid row as a CodeMirror JSON document (BSON constructor
 *  syntax for Mongo rows, plain JSON otherwise) with the same highlighting as
 *  the console editor, folding to collapse whole objects, search/wrap/copy and
 *  an expanded dialog. Editing the document commits changed top-level fields
 *  back into the grid's buffered state (on blur or Cmd/Ctrl+S) so the toolbar
 *  Apply reviews + persists them. Resizable by its left edge. */
export function JsonViewer({
  conn_id,
  tab_key,
}: {
  conn_id: string;
  tab_key: string | null;
}) {
  // The visible row is scoped to the ACTIVE tab: switching tabs/connections
  // shows that tab's selection (or nothing), never a stale row from another.
  const jsonRow = useStudioStore((s) =>
    tab_key ? s.jsonRows[`${conn_id}\u0000${tab_key}`] ?? null : null,
  );
  const width = useStudioStore((s) => s.rightSidebarWidth);
  const setWidth = useStudioStore((s) => s.setRightSidebarWidth);
  const close = useStudioStore((s) => s.setRightSidebarOpen);

  const [dragging, setDragging] = useState(false);
  const drag_ref = useRef<{ start_x: number; start_w: number } | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const on_move = (e: PointerEvent) => {
      const d = drag_ref.current;
      if (!d) return;
      const w = d.start_w + (d.start_x - e.clientX);
      setWidth(Math.min(560, Math.max(240, w)));
    };
    const on_up = () => {
      setDragging(false);
      drag_ref.current = null;
    };
    window.addEventListener("pointermove", on_move);
    window.addEventListener("pointerup", on_up);
    return () => {
      window.removeEventListener("pointermove", on_move);
      window.removeEventListener("pointerup", on_up);
    };
  }, [dragging, setWidth]);

  const [wrap, setWrap] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Editing is opt-in: the document stays read-only until the pencil is
  // clicked. Resets per selected row (not per republish) so live commits
  // don't lock the editor mid-type.
  const [editable, setEditable] = useState(false);
  const rowKey = jsonRow
    ? `${conn_id}\u0000${tab_key}\u0000${jsonRow.row_number}`
    : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset edit per selected row
    setEditable(false);
  }, [rowKey]);
  useEffect(() => {
    if (!dialogOpen) return;
    const on_key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDialogOpen(false);
    };
    window.addEventListener("keydown", on_key);
    return () => window.removeEventListener("keydown", on_key);
  }, [dialogOpen]);

  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [matchPos, setMatchPos] = useState<{ from: number; to: number }[]>([]);
  const searching = query.trim().length > 0;

  // Live editor handle + the parses/commits go through a ref so the keymap and
  // blur handler installed once never read stale closures.
  const viewRef = useRef<EditorView | null>(null);
  const jsonRowRef = useRef(jsonRow);
  // Snapshot of what the editor is currently displaying; the diff baseline for
  // commits. Reset whenever the externally-published row changes.
  const baselineRef = useRef<{ data: Record<string, unknown>; text: string } | null>(
    null,
  );

// Mongo rows render from their BSON AST (rebuilt from the flat grid row so
  // ObjectId / ISODate show as constructors); everything else is plain JSON.
  const doc = useMemo(() => {
    if (!jsonRow) return "";
    if (jsonRow.kind === "mongo") {
      const columns = Object.keys(jsonRow.data);
      const row = columns.map(
        (c) => (jsonRow.data[c] as string | null) ?? null,
      );
      return renderMongoDocument(
        rowToDocument(columns, row, (c) => jsonRow.col_types?.[c]),
      );
    }
    return JSON.stringify(jsonRow.data, null, 2);
  }, [jsonRow]);

  useEffect(() => {
    if (!jsonRow || !doc) return;
    baselineRef.current = { data: jsonRow.data, text: doc };
  }, [jsonRow, doc]);

  // While the sidebar editor is focused its live content (uncontrolled inside
  // the view) is the source of truth; republishes from the grid must not reset
  // it mid-type. `shownDoc` follows `doc` again once the editor loses focus.
  const [editorFocused, setEditorFocused] = useState(false);
  const [shownDoc, setShownDoc] = useState(doc);
  useEffect(() => {
    if (editorFocused) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- catch up now-live doc on selection change
    setShownDoc(doc);
  }, [editorFocused, doc]);

  // Match navigation recomputes over the live document.
  useEffect(() => {
    if (!searching) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- recompute search matches
      setMatchPos([]);
      setActiveMatch(0);
      return;
    }
    const q = query.toLowerCase();
    const source = viewRef.current?.state.doc.toString() ?? doc;
    const out: { from: number; to: number }[] = [];
    let i = source.toLowerCase().indexOf(q);
    while (i !== -1) {
      out.push({ from: i, to: i + q.length });
      i = source.toLowerCase().indexOf(q, i + q.length);
    }
    setMatchPos(out);
    setActiveMatch(0);
    const view = viewRef.current;
    if (out.length > 0 && view) {
      view.dispatch({
        selection: { anchor: out[0].from },
        effects: EditorView.scrollIntoView(out[0].from, { y: "center" }),
      });
    }
  }, [query, doc, searching]);

  // Push the current matches into the editor as decorations — recomputing
  // matches (above) doesn't by itself repaint the view.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setSearchMatches.of({ ranges: matchPos, active: activeMatch }) });
  }, [matchPos, activeMatch]);

  const jump = useCallback(
    (i: number) => {
      const pos = matchPos[i];
      const view = viewRef.current;
      if (!pos || !view) return;
      view.dispatch({
        selection: { anchor: pos.from },
        effects: EditorView.scrollIntoView(pos.from, { y: "center" }),
      });
      view.focus();
    },
    [matchPos],
  );
  const goNext = useCallback(() => {
    if (matchPos.length === 0) return;
    const i = (activeMatch + 1) % matchPos.length;
    setActiveMatch(i);
    jump(i);
  }, [matchPos.length, activeMatch, jump]);
  const goPrev = useCallback(() => {
    if (matchPos.length === 0) return;
    const i = (activeMatch - 1 + matchPos.length) % matchPos.length;
    setActiveMatch(i);
    jump(i);
  }, [matchPos.length, activeMatch, jump]);

  const copy = () => {
    if (!jsonRow) return;
    void navigator.clipboard.writeText(JSON.stringify(jsonRow.data, null, 2));
  };

  // Parse the whole editor document and write every changed top-level field
  // back into the grid's buffer (BSON for Mongo rows, plain JSON otherwise).
  const commit = useCallback(() => {
    const row = jsonRowRef.current;
    const view = viewRef.current;
    if (!view || !row?.on_edit) return;
    const text = view.state.doc.toString();
    const base = baselineRef.current;
    if (!base || text === base.text) return;

    let after: Record<string, unknown>;
    if (row.kind === "mongo") {
      const { value, error } = parseMongoJson(text);
      if (error || value.kind !== "object") return;
      after = Object.fromEntries(value.value.entries());
    } else {
      try {
        const v = JSON.parse(text);
        if (typeof v !== "object" || v === null || Array.isArray(v)) return;
        after = v as Record<string, unknown>;
      } catch {
        return;
      }
    }

    let changed = false;
    for (const k of Object.keys(after)) {
      if (row.kind === "mongo" && k === "_id") continue;
      const nv = after[k];
      const ov = base.data[k];
      if (JSON.stringify(nv) === JSON.stringify(ov)) continue;
      changed = true;
      const cell =
        row.kind === "mongo"
          ? valueToCell(nv as MongoJsonValue)
          : sqlCell(nv);
      row.on_edit(k, cell);
    }
    if (changed)
      baselineRef.current = { data: after, text: base.text };
  }, []);

  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
    jsonRowRef.current = jsonRow;
  }, [commit, jsonRow]);

  // Live commits: every pause in typing (500 ms) writes changed top-level
  // fields back into the grid's buffer so Apply can review them; blur and
  // Cmd/Ctrl+S still commit immediately.
  const debounceRef = useRef<number | null>(null);
  const on_change = useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      commitRef.current();
    }, 500);
  }, [commitRef]);
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const saveKeymap = useMemo(
    () =>
      Prec.highest(
        // eslint-disable-next-line react-hooks/refs -- keymap runs at event time
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              commitRef.current();
              return true;
            },
          },
        ]),
      ),
    [],
  );
  const wrapExt = useMemo(
    () => (wrap ? [EditorView.lineWrapping] : []),
    [wrap],
  );
  // Memoized: a fresh array here would change `extraExtensions`' identity on
  // every render (this component re-renders often — search, doc updates,
  // …), and BsonEditor's own `extensions` memo (and CodeMirror's reconfigure
  // effect downstream of it) key off that identity. Reconfiguring tears down
  // and rebuilds every extension, including autocompletion(), which kills
  // any in-progress/open completion before it can show.
  const extraExtensions = useMemo(
    () => [saveKeymap, searchMatchField, searchMatchTheme, ...wrapExt],
    [saveKeymap, wrapExt],
  );

  const editorProps = {
    // `shownDoc` stays frozen while the editor is focused so a grid republish
    // never resets the document under the user's cursor; it snaps to the
    // freshest doc on blur/selection change.
    value: shownDoc,
    // The viewer is committed to the grid on a typing pause via on_change,
    // plus immediately on blur / Cmd+S.
    onChange: on_change,
    readOnly: !jsonRow?.on_edit || !editable,
    foldable: true,
    constructorsOnly: true,
    onCreateEditor: (v: EditorView) => {
      viewRef.current = v;
      // A fresh editor instance (e.g. opening the expanded dialog) starts
      // with no decorations — restore whatever matches are currently active.
      v.dispatch({ effects: setSearchMatches.of({ ranges: matchPos, active: activeMatch }) });
    },
    onBlur: () => commitRef.current(),
    extraExtensions,
  };

  const headerProps = {
    query,
    onQueryChange: (q: string) => setQuery(q),
    searching,
    matchCount: matchPos.length,
    activeMatch,
    onPrev: goPrev,
    onNext: goNext,
    onClear: () => {
      setQuery("");
      setActiveMatch(0);
    },
    wrap,
    onToggleWrap: () => setWrap((w) => !w),
    onCopy: copy,
    onClose: () => close(false),
    editable,
    editDisabled: !jsonRow?.on_edit,
    onToggleEdit: () => setEditable((v) => !v),
  };

  return (
    <AnimatePresence>
      {!dialogOpen && (
        <motion.aside
          key="json-sidebar"
          layoutId="json-panel"
          transition={layoutTransition}
          className="bg-background relative flex min-h-0 shrink-0 flex-col border-l"
          style={{ width }}
        >
          <div
            className="flex min-h-0 flex-1 flex-col"
            onFocus={() => setEditorFocused(true)}
            onBlur={() => setEditorFocused(false)}
          >
            <TreeControls
              {...headerProps}
              onExpand={() => setDialogOpen(true)}
            />
            {jsonRow ? (
              <BsonEditor
                {...editorProps}
                className="min-w-0 flex-1 rounded-none border-0"
                minHeight="calc(100%-34px)"
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
                <Braces className="text-muted-foreground/40 size-8" />
                <p className="text-muted-foreground text-sm">
                  No row selected. Right-click any grid cell and choose "View
                  JSON" to inspect its row here.
                </p>
              </div>
            )}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag_ref.current = { start_x: e.clientX, start_w: width };
              setDragging(true);
            }}
            className={cn(
              "absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize",
              dragging ? "bg-primary/60" : "hover:bg-accent bg-transparent",
            )}
          />
        </motion.aside>
      )}
      {dialogOpen && jsonRow && (
        <motion.div
          key="json-dialog"
          className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setDialogOpen(false)}
        >
          <motion.div
            layoutId="json-panel"
            transition={layoutTransition}
            role="dialog"
            aria-modal="true"
            aria-label="Row JSON"
            className="bg-background pointer-events-auto flex h-[80vh] w-[min(760px,92vw)] min-w-0 flex-col overflow-hidden rounded-xl border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <TreeControls
              {...headerProps}
              onClose={() => setDialogOpen(false)}
            />
            <div className="flex min-h-0 flex-1 flex-col">
              <BsonEditor
                {...editorProps}
                className="min-w-0 flex-1 rounded-none border-0"
                minHeight="100%"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}