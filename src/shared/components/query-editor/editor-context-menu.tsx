import type { ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import { selectAll } from "@codemirror/commands";
import {
  openSearchPanel,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import {
  Braces,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  ClipboardPaste,
  Combine,
  Copy,
  CopyCheck,
  CornerDownLeft,
  Eraser,
  ListOrdered,
  MousePointerClick,
  Play,
  Save,
  Scissors,
  Search,
  TextSelect,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import {
  formatBinding,
  type ShortcutBinding,
} from "@/shared/hooks/shortcut-registry";
import {
  joinLines,
  deleteBlankLines,
  uppercaseSelection,
  lowercaseSelection,
  cycleSelectionNamingStyle,
  pasteAsSqlInCondition,
} from "./editor-text-commands";

/** Static, display-only bindings for actions that aren't app-registered,
 *  remappable shortcuts (`shortcut-registry.ts`) — standard OS/CodeMirror
 *  conventions (copy/cut/paste, find, select-all) or a `@codemirror/search`
 *  command whose bundled default key this app doesn't touch. Shown for the
 *  same reason the real bindings are: so the menu documents what fires it. */
const STATIC_BINDINGS = {
  copy: { key: "c", mod: true },
  cut: { key: "x", mod: true },
  paste: { key: "v", mod: true },
  addOccurrence: { key: "d", mod: true },
  find: { key: "f", mod: true },
  selectAll: { key: "a", mod: true },
} as const satisfies Record<string, ShortcutBinding>;

function Shortcut({ binding }: { binding: ShortcutBinding }) {
  return <ContextMenuShortcut>{formatBinding(binding)}</ContextMenuShortcut>;
}

/** Right-click menu for the SQL/Mongo editor — the mouse-driven counterpart
 *  to this app's own keyboard shortcuts (`editor-text-commands.ts`,
 *  `shortcut-registry.ts`) plus a few `@codemirror/commands`/`search`
 *  commands (select-next-occurrence, select-all-occurrences, select-all,
 *  find) that already ship with CodeMirror and just weren't surfaced
 *  anywhere clickable before. Deliberately NOT trying to match every entry
 *  of a full SQL-IDE menu (Execute/Preview/Export/View DDL/Send to AI, …) —
 *  those need a table/connection/DB-tool context this reusable editor
 *  doesn't have; add them at the call site (`editor-run-toolbar.tsx` already
 *  owns Run/Format/Save as toolbar buttons) if that's ever wanted here too. */
export function EditorContextMenu({
  children,
  getView,
  onRun,
  onRunTarget,
  onSave,
  readOnly,
  runBinding,
  runTargetBinding,
  saveBinding,
  joinLinesBinding,
  deleteBlankLinesBinding,
  uppercaseBinding,
  lowercaseBinding,
  cycleNamingBinding,
  pasteAsInBinding,
  delimitedListBinding,
  onOpenDelimitedList,
}: {
  children: ReactNode;
  /** Reads the live view lazily, at click time — never during render (a
   *  ref read during render is a React-Compiler purity violation, and the
   *  view can go from null to real between renders as CodeMirror mounts). */
  getView: () => EditorView | null;
  onRun: () => void;
  onRunTarget: () => void;
  onSave?: () => void;
  readOnly: boolean;
  runBinding: ShortcutBinding;
  runTargetBinding: ShortcutBinding;
  saveBinding: ShortcutBinding;
  joinLinesBinding: ShortcutBinding;
  deleteBlankLinesBinding: ShortcutBinding;
  uppercaseBinding: ShortcutBinding;
  lowercaseBinding: ShortcutBinding;
  cycleNamingBinding: ShortcutBinding;
  pasteAsInBinding: ShortcutBinding;
  delimitedListBinding: ShortcutBinding;
  onOpenDelimitedList: () => void;
}) {
  const run = (command: (view: EditorView) => unknown) => () => {
    const view = getView();
    if (view) command(view);
  };
  const copy = () => {
    const view = getView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    void navigator.clipboard.writeText(view.state.sliceDoc(from, to));
  };
  const cut = () => {
    const view = getView();
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    void navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.dispatch(view.state.replaceSelection(""));
    view.focus();
  };
  const paste = () => {
    const view = getView();
    if (!view) return;
    void navigator.clipboard.readText().then((text) => {
      if (!text) return;
      view.dispatch(view.state.replaceSelection(text));
      view.focus();
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-64">
        <ContextMenuItem onSelect={onRun}>
          <Play className="size-3.5" />
          Run query
          <Shortcut binding={runBinding} />
        </ContextMenuItem>
        <ContextMenuItem onSelect={onRunTarget}>
          <CornerDownLeft className="size-3.5" />
          Run targeted statement
          <Shortcut binding={runTargetBinding} />
        </ContextMenuItem>
        {onSave && (
          <ContextMenuItem onSelect={onSave}>
            <Save className="size-3.5" />
            Save
            <Shortcut binding={saveBinding} />
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Copy className="size-3.5 mr-2" />
            Clipboard
          </ContextMenuSubTrigger>
          <ContextMenuSubContent side="right">
            <ContextMenuItem onSelect={copy}>
              <Copy className="size-3.5" />
              Copy selection
              <Shortcut binding={STATIC_BINDINGS.copy} />
            </ContextMenuItem>
            {!readOnly && (
              <>
                <ContextMenuItem onSelect={cut}>
                  <Scissors className="size-3.5" />
                  Cut selection
                  <Shortcut binding={STATIC_BINDINGS.cut} />
                </ContextMenuItem>
                <ContextMenuItem onSelect={paste}>
                  <ClipboardPaste className="size-3.5" />
                  Paste
                  <Shortcut binding={STATIC_BINDINGS.paste} />
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {!readOnly && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={run(joinLines)}>
              <Combine className="size-3.5" />
              Join lines
              <Shortcut binding={joinLinesBinding} />
            </ContextMenuItem>
            <ContextMenuItem onSelect={run(deleteBlankLines)}>
              <Eraser className="size-3.5" />
              Delete blank lines
              <Shortcut binding={deleteBlankLinesBinding} />
            </ContextMenuItem>
            <ContextMenuItem onSelect={run(uppercaseSelection)}>
              <CaseUpper className="size-3.5" />
              Convert to uppercase
              <Shortcut binding={uppercaseBinding} />
            </ContextMenuItem>
            <ContextMenuItem onSelect={run(lowercaseSelection)}>
              <CaseLower className="size-3.5" />
              Convert to lowercase
              <Shortcut binding={lowercaseBinding} />
            </ContextMenuItem>
            <ContextMenuItem onSelect={run(cycleSelectionNamingStyle)}>
              <CaseSensitive className="size-3.5" />
              Toggle naming style
              <Shortcut binding={cycleNamingBinding} />
            </ContextMenuItem>
            <ContextMenuItem onSelect={onOpenDelimitedList}>
              <ListOrdered className="size-3.5" />
              Convert to delimited list…
              <Shortcut binding={delimitedListBinding} />
            </ContextMenuItem>
            <ContextMenuItem onSelect={run(pasteAsSqlInCondition)}>
              <Braces className="size-3.5" />
              Paste as SQL IN condition
              <Shortcut binding={pasteAsInBinding} />
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={run(selectNextOccurrence)}>
          <MousePointerClick className="size-3.5" />
          Add next occurrence
          <Shortcut binding={STATIC_BINDINGS.addOccurrence} />
        </ContextMenuItem>
        <ContextMenuItem onSelect={run(selectSelectionMatches)}>
          <CopyCheck className="size-3.5" />
          Select all occurrences
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={run(openSearchPanel)}>
          <Search className="size-3.5" />
          Find/Replace
          <Shortcut binding={STATIC_BINDINGS.find} />
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={run(selectAll)}>
          <TextSelect className="size-3.5" />
          Select all
          <Shortcut binding={STATIC_BINDINGS.selectAll} />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
