import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { history } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editTargetForFocus,
  rememberEditTarget,
  runEditAction,
  TITLE_BAR_ATTR,
} from "../edit-actions";

let exec: ReturnType<typeof vi.fn>;
let clipboard: {
  readText: ReturnType<typeof vi.fn>;
  writeText: ReturnType<typeof vi.fn>;
};

const views: EditorView[] = [];

beforeEach(() => {
  // jsdom has no layout; CodeMirror's measure pass calls these.
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  exec = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", {
    value: exec,
    configurable: true,
  });
  clipboard = {
    readText: vi.fn().mockResolvedValue("pasted"),
    writeText: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(navigator, "clipboard", {
    value: clipboard,
    configurable: true,
  });
});

afterEach(() => {
  views.splice(0).forEach((v) => v.destroy());
  document.body.innerHTML = "";
});

function focused<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  el.focus();
  rememberEditTarget();
  return el;
}

describe("edit actions on a plain input", () => {
  it("runs the browser command on the field focused before the menu opened", () => {
    const input = focused(document.createElement("input"));
    const menuButton = document.createElement("button");
    document.body.appendChild(menuButton);
    menuButton.focus(); // the menu stole focus

    runEditAction("undo");

    expect(document.activeElement).toBe(input);
    expect(exec).toHaveBeenCalledWith("undo");
  });

  it("maps select all to the browser's selectAll", () => {
    focused(document.createElement("textarea"));
    runEditAction("select_all");
    expect(exec).toHaveBeenCalledWith("selectAll");
  });

  it("pastes clipboard text, since execCommand paste is blocked", async () => {
    focused(document.createElement("input"));
    runEditAction("paste");
    await vi.waitFor(() =>
      expect(exec).toHaveBeenCalledWith("insertText", false, "pasted"),
    );
    expect(exec).not.toHaveBeenCalledWith("paste");
  });

  it("does nothing when nothing was focused", () => {
    rememberEditTarget();
    runEditAction("copy");
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("title bar focus", () => {
  it("never treats its own button as the field to edit", () => {
    const bar = document.createElement("div");
    bar.setAttribute(TITLE_BAR_ATTR, "");
    const button = document.createElement("button");
    bar.appendChild(button);
    document.body.appendChild(bar);
    button.focus();
    rememberEditTarget();

    runEditAction("copy");

    expect(exec).not.toHaveBeenCalled();
    expect(editTargetForFocus()).toBe(true);
  });

  it("returns focus to the remembered field", () => {
    const input = focused(document.createElement("input"));
    expect(editTargetForFocus()).toBe(input);
  });
});

describe("edit actions in CodeMirror", () => {
  function mount(
    doc: string,
    extra: Parameters<typeof EditorState.create>[0] = {},
  ) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: [history()], ...extra }),
    });
    views.push(view);
    view.focus();
    rememberEditTarget();
    return view;
  }

  it("undoes and redoes through the editor's own history", () => {
    const view = mount("a");
    view.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input" });
    expect(view.state.doc.toString()).toBe("ab");

    runEditAction("undo");
    expect(view.state.doc.toString()).toBe("a");
    runEditAction("redo");
    expect(view.state.doc.toString()).toBe("ab");
    expect(exec).not.toHaveBeenCalled();
  });

  it("selects all, copies and cuts the selection", () => {
    const view = mount("hello");
    runEditAction("select_all");
    expect(view.state.selection.main.to).toBe(5);

    runEditAction("copy");
    expect(clipboard.writeText).toHaveBeenCalledWith("hello");

    runEditAction("cut");
    expect(view.state.doc.toString()).toBe("");
  });

  it("pastes at the cursor", async () => {
    const view = mount("ab");
    view.dispatch({ selection: { anchor: 1 } });
    runEditAction("paste");
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("apastedb"));
  });

  it("leaves a read only editor unchanged on cut and paste", async () => {
    const view = mount("locked", {
      extensions: [history(), EditorState.readOnly.of(true)],
    });
    runEditAction("select_all");
    runEditAction("cut");
    runEditAction("paste");
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe("locked");
  });
});

describe("edit actions elsewhere", () => {
  it("replays the shortcut so the data grid can handle it", () => {
    const grid = focused(document.createElement("div"));
    grid.tabIndex = 0;
    grid.focus();
    rememberEditTarget();
    const onKey = vi.fn((e: KeyboardEvent) => e.preventDefault());
    grid.addEventListener("keydown", onKey);

    runEditAction("copy");

    expect(onKey).toHaveBeenCalledTimes(1);
    const e = onKey.mock.calls[0][0];
    expect([e.key, e.ctrlKey]).toEqual(["c", true]);
    expect(exec).not.toHaveBeenCalled();
  });

  it("falls back to the browser when nothing handled the shortcut", () => {
    const el = focused(document.createElement("div"));
    el.tabIndex = 0;
    el.focus();
    rememberEditTarget();
    runEditAction("copy");
    expect(exec).toHaveBeenCalledWith("copy");
  });
});
