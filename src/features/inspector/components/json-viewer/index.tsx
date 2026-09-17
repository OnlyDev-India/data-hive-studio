import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { useStudioStore } from "@/shared/store";
import { useShortcuts } from "@/shared/hooks/use-shortcut";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { TreeControls } from "./tree-controls";
import { JsonViewerToolbar } from "./json-viewer-toolbar";
import {
  parseMongoJson,
  renderMongoDocument,
  rowToDocument,
  valueToCell,
  type MongoJsonValue,
} from "@/shared/lib/mongo-json";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import {
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { BsonEditor } from "@/features/query-editor";

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
              class:
                i === e.value.active
                  ? "cm-search-match-active"
                  : "cm-search-match",
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
 *  Apply reviews + persists them. Rendered as a `ResizablePanel` below the
 *  grid (see `table-pane.tsx`/`mongo-collection-pane.tsx`) — sizing and
 *  open/closed state are entirely the parent's concern now, not this
 *  component's (it used to host its own drag-resize and a framer-motion
 *  shared-layout morph into the dialog below; both were dropped as the main
 *  source of this feature's bugs). */
export function JsonViewer({
  conn_id,
  tab_key,
}: {
  conn_id: string;
  tab_key: string;
}) {
  // The visible row is scoped to the ACTIVE tab: switching tabs/connections
  // shows that tab's selection (or nothing), never a stale row from another.
  const jsonRow = useStudioStore(
    (s) => s.jsonRows[`${conn_id}\u0000${tab_key}`] ?? null,
  );
  const setBottomPanelOpen = useStudioStore((s) => s.setBottomPanelOpen);
  const close = () => setBottomPanelOpen(false);

  const [wrap, setWrap] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Editing is opt-in: the document stays read-only until the pencil is
  // clicked. Resets per selected row (not per republish) so live commits
  // don't lock the editor mid-type.
  const [editable, setEditable] = useState(false);
  // A pending row's `row_number` is its 0-based index in the draft batch,
  // not a real row position (see JsonRow's doc comment) — it can collide
  // numerically with a real row's row_number, so is_pending has to be part
  // of the key too, not inferred from the number alone.
  const rowKey = jsonRow
    ? `${conn_id}\u0000${tab_key}\u0000${jsonRow.is_pending ? "p" : "r"}${jsonRow.row_number}`
    : null;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset edit per selected row
    setEditable(false);
  }, [rowKey]);
  useShortcuts(
    [
      {
        key: "Escape",
        preventDefault: false,
        handler: () => setDialogOpen(false),
      },
    ],
    { enabled: dialogOpen },
  );

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
  const baselineRef = useRef<{
    data: Record<string, unknown>;
    text: string;
  } | null>(null);

  // Parse the whole editor document and write every changed top-level field
  // back into the grid's buffer (BSON for Mongo rows, plain JSON otherwise).
  // Declared early (reads only refs) so the row-switch effect below — which
  // must flush the outgoing row before its baseline is replaced — can call
  // it via `commitRef`.
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
        row.kind === "mongo" ? valueToCell(nv as MongoJsonValue) : sqlCell(nv);
      row.on_edit(k, cell);
    }
    if (changed) baselineRef.current = { data: after, text: base.text };
  }, []);

  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

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

  // While the panel's editor is focused its live content (uncontrolled inside
  // the view) is the source of truth; republishes from the grid must not reset
  // it mid-type. `shownDoc` follows `doc` again once the editor loses focus.
  const [editorFocused, setEditorFocused] = useState(false);
  const [shownDoc, setShownDoc] = useState(doc);
  // Identifies WHICH row is published (not the JsonRow object identity,
  // which changes on every republish — including ones triggered by this
  // panel's own edits round-tripping back through dirty_cells for the SAME
  // row). Used to tell "the grid selection moved to a different row" apart
  // from "this same row was republished with fresher data".
  const prevRowKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const row_switched =
      prevRowKeyRef.current !== null && prevRowKeyRef.current !== rowKey;
    if (row_switched && editorFocused) {
      // The grid selection moved to a different row while this row's text
      // was still on screen (editor focused) — flush it against ITS OWN
      // baseline now, before jsonRowRef/baselineRef advance to the new row
      // below. Without this, a later debounce/blur commit would diff this
      // still-displayed old-row text against the NEW row's baseline and
      // write the difference onto the wrong row via its `on_edit`.
      commitRef.current();
    }
    prevRowKeyRef.current = rowKey;
    jsonRowRef.current = jsonRow;
    baselineRef.current =
      jsonRow && doc ? { data: jsonRow.data, text: doc } : null;
    if (!editorFocused || row_switched) {
      setShownDoc(doc);
    }
  }, [jsonRow, doc, rowKey, editorFocused]);

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
    view.dispatch({
      effects: setSearchMatches.of({ ranges: matchPos, active: activeMatch }),
    });
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
      if (debounceRef.current !== null)
        window.clearTimeout(debounceRef.current);
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
  // Memoized: a fresh array here would change `extraExtensions`' identity on
  // every render (this component re-renders often — search, doc updates,
  // …), and BsonEditor's own `extensions` memo (and CodeMirror's reconfigure
  // effect downstream of it) key off that identity. Reconfiguring tears down
  // and rebuilds every extension, including autocompletion(), which kills
  // any in-progress/open completion before it can show.
  const extraExtensions = useMemo(
    () => [saveKeymap, searchMatchField, searchMatchTheme],
    [saveKeymap],
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
      v.dispatch({
        effects: setSearchMatches.of({ ranges: matchPos, active: activeMatch }),
      });
    },
    onBlur: () => commitRef.current(),
    extraExtensions,
  };

  const toolbarProps = {
    wrap,
    onToggleWrap: () => setWrap((w) => !w),
    onCopy: copy,
    editable,
    editDisabled: !jsonRow?.on_edit,
    onToggleEdit: () => setEditable((v) => !v),
    disabled: !jsonRow,
  };

  return (
    <div
      className="bg-background flex min-h-0 flex-1 flex-col"
      onFocus={() => setEditorFocused(true)}
      onBlur={() => setEditorFocused(false)}
    >
      <TreeControls
        query={query}
        onQueryChange={setQuery}
        searching={searching}
        matchCount={matchPos.length}
        activeMatch={activeMatch}
        onPrev={goPrev}
        onNext={goNext}
        onClear={() => {
          setQuery("");
          setActiveMatch(0);
        }}
        onClose={close}
        disabled={!jsonRow}
      />
      <JsonViewerToolbar
        {...toolbarProps}
        onExpand={() => setDialogOpen(true)}
      />
      {jsonRow ? (
        <BsonEditor
          {...editorProps}
          className="min-w-0 flex-1 rounded-none border-0"
          minHeight="calc(100%-34px)"
          disableWrapping={!wrap}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <Braces className="text-muted-foreground/40 size-8" />
          <p className="text-muted-foreground text-sm">
            No row selected. Right-click any grid cell and choose "View JSON" to
            inspect its row here.
          </p>
        </div>
      )}
      {jsonRow && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent
            className="flex h-[80vh] w-[min(760px,92vw)] max-w-[92vw] min-w-0 flex-col gap-0 overflow-hidden p-0"
            hideCloseButton
          >
            <DialogTitle className="sr-only">Row JSON</DialogTitle>
            <TreeControls
              query={query}
              onQueryChange={setQuery}
              searching={searching}
              matchCount={matchPos.length}
              activeMatch={activeMatch}
              onPrev={goPrev}
              onNext={goNext}
              onClear={() => {
                setQuery("");
                setActiveMatch(0);
              }}
              onClose={() => setDialogOpen(false)}
            />
            <JsonViewerToolbar {...toolbarProps} />
            <div className="flex min-h-0 flex-1 flex-col">
              <BsonEditor
                {...editorProps}
                className="min-w-0 flex-1 rounded-none border-0"
                minHeight="100%"
                disableWrapping={!wrap}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
