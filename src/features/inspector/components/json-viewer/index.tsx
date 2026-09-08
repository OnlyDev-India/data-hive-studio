import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { Braces } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import { useShortcuts } from "@/shared/hooks/use-shortcut";
import { TreeControls } from "./tree-controls";
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

const layoutTransition: Transition = { duration: 0.3, ease: "easeInOut" };
// Used for the single render right after a drag-resize ends — see
// `instantSettle`'s comment at its declaration.
const instantTransition: Transition = { duration: 0 };

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
 *  Apply reviews + persists them. Resizable by its left edge. */
export function JsonViewer({
  conn_id,
  tab_key,
  landing = false,
}: {
  conn_id: string;
  tab_key: string | null;
  /** True while the connection's Home/landing view is showing instead of a
   *  table — there's no row to inspect there, so the panel hides (without
   *  unmounting, for the same "keep the shared-layout animation" reason
   *  noted below) and reappears if the panel was open when Home was left. */
  landing?: boolean;
}) {
  // The visible row is scoped to the ACTIVE tab: switching tabs/connections
  // shows that tab's selection (or nothing), never a stale row from another.
  const jsonRow = useStudioStore((s) =>
    tab_key ? (s.jsonRows[`${conn_id}\u0000${tab_key}`] ?? null) : null,
  );
  // Read directly rather than relying on the host (workspace.tsx) to
  // mount/unmount this whole component per toggle — this component (and its
  // `motion.aside`'s `layoutId="json-panel"` shared-layout transition with
  // the dialog below) needs to stay mounted continuously for its own
  // AnimatePresence to animate cleanly; tearing the whole tree down and
  // rebuilding it on every close/reopen left the reopened panel stuck at
  // its exit-animation values (opacity: 0, pointer-events: none) since
  // there was no longer a "from" element for the shared layout animation to
  // resolve against.
  const panel_open = useStudioStore((s) => s.rightSidebarOpen);
  const open = panel_open && !landing;
  const width = useStudioStore((s) => s.rightSidebarWidth);
  const setWidth = useStudioStore((s) => s.setRightSidebarWidth);
  const close = useStudioStore((s) => s.setRightSidebarOpen);

  const [dragging, setDragging] = useState(false);
  const drag_ref = useRef<{ start_x: number; start_w: number } | null>(null);
  // The panel's own DOM node — during a drag, width is written here directly
  // (bypassing React) instead of through `setWidth` on every pointermove.
  // `setWidth` is a state update, which re-renders this `motion.aside`; even
  // with `layout={!dragging}` disabling the FLIP animation, `layoutId`
  // still puts the element through Framer Motion's layout-measurement pass
  // on every one of those re-renders, and that overhead was exactly the
  // "background snaps but everything else lags behind" feel — the DOM
  // width was updating, but a beat behind whatever Framer was busy
  // re-measuring. Mutating the node directly skips React (and therefore
  // Framer) entirely while the pointer is moving, so this tracks the cursor
  // exactly like the plain, non-motion sidebar does; only the FINAL value
  // on pointerup goes through `setWidth`, for a single settling re-render.
  const asideRef = useRef<HTMLElement | null>(null);
  const liveWidthRef = useRef(width);
  // Set for exactly one render right after a drag ends — re-enabling
  // `layout` there makes Framer notice the width is different from
  // whatever it last measured before `layout={false}` started ignoring
  // DOM changes, so it schedules a FLIP correction. With the normal 300ms
  // `layoutTransition` that correction itself becomes a second, unwanted
  // animation right as the cursor stops — the panel visibly settles into
  // place a beat late instead of already being where the cursor let go.
  // Forcing that one correction to `duration: 0` makes it apply instantly
  // (it's already the right size, so there's nothing to actually animate),
  // and the ref below flips it back to the real transition on the very
  // next frame so open/close and the dialog-morph animate as before.
  const [instantSettle, setInstantSettle] = useState(false);
  useEffect(() => {
    if (!instantSettle) return;
    const id = requestAnimationFrame(() => setInstantSettle(false));
    return () => cancelAnimationFrame(id);
  }, [instantSettle]);
  useEffect(() => {
    if (!dragging) return;
    const on_move = (e: PointerEvent) => {
      const d = drag_ref.current;
      if (!d) return;
      const w = Math.min(
        560,
        Math.max(240, d.start_w + (d.start_x - e.clientX)),
      );
      liveWidthRef.current = w;
      if (asideRef.current) asideRef.current.style.width = `${w}px`;
    };
    const on_up = () => {
      setDragging(false);
      drag_ref.current = null;
      setWidth(liveWidthRef.current);
      setInstantSettle(true);
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

  // While the sidebar editor is focused its live content (uncontrolled inside
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
      v.dispatch({
        effects: setSearchMatches.of({ ranges: matchPos, active: activeMatch }),
      });
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
    disabled: !jsonRow,
  };

  return (
    <AnimatePresence>
      {open && !dialogOpen && (
        <motion.aside
          key="json-sidebar"
          ref={asideRef}
          layoutId="json-panel"
          // `layoutId` auto-animates ANY width change with `transition`
          // below (300ms easeInOut) — great for the open/close slide, but
          // during a manual drag-resize `width` updates on every
          // pointermove, so each tick would re-trigger that same 300ms
          // animation instead of tracking the cursor 1:1, making the resize
          // feel like it's dragging through syrup. Disabling layout
          // animation for the duration of the drag makes width changes
          // apply immediately instead.
          layout={!dragging}
          transition={instantSettle ? instantTransition : layoutTransition}
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
      {open && dialogOpen && jsonRow && (
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
