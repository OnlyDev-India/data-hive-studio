import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  joinLines,
  deleteBlankLines,
  uppercaseSelection,
  lowercaseSelection,
  cycleNamingStyle,
  cycleSelectionNamingStyle,
  pasteAsSqlInCondition,
} from "../editor-text-commands";

function makeView(doc: string, cursor = 0) {
  const state = EditorState.create({
    doc,
    selection: { anchor: cursor },
  });
  return new EditorView({ state, parent: document.body });
}

describe("joinLines", () => {
  it("joins the current line with the next, inserting one space", () => {
    const view = makeView("SELECT 1\nFROM t", 0);
    const changed = joinLines(view);
    expect(changed).toBe(true);
    expect(view.state.doc.toString()).toBe("SELECT 1 FROM t");
    view.destroy();
  });

  it("trims the next line's leading whitespace instead of doubling spaces", () => {
    const view = makeView("SELECT 1\n   FROM t", 0);
    joinLines(view);
    expect(view.state.doc.toString()).toBe("SELECT 1 FROM t");
    view.destroy();
  });

  it("doesn't insert a space when joining onto a blank line", () => {
    const view = makeView("SELECT 1\n\nFROM t", 0);
    joinLines(view);
    expect(view.state.doc.toString()).toBe("SELECT 1\nFROM t");
    view.destroy();
  });

  it("joins every line spanned by a multi-line selection", () => {
    const view = makeView("A\nB\nC\nD", 0);
    view.dispatch({ selection: { anchor: 0, head: 5 } }); // covers A, B, C
    joinLines(view);
    expect(view.state.doc.toString()).toBe("A B C\nD");
    view.destroy();
  });

  it("does nothing on the last line", () => {
    const view = makeView("SELECT 1", 8);
    expect(joinLines(view)).toBe(false);
    view.destroy();
  });
});

describe("deleteBlankLines", () => {
  it("removes blank lines within the whole document when nothing is selected", () => {
    const view = makeView("A\n\n\nB\nC\n\nD", 0);
    const changed = deleteBlankLines(view);
    expect(changed).toBe(true);
    expect(view.state.doc.toString()).toBe("A\nB\nC\nD");
    view.destroy();
  });

  it("only touches blank lines inside the selection", () => {
    const view = makeView("A\n\nB\n\nC", 0);
    // Select just the first blank-line region (through the start of B).
    view.dispatch({ selection: { anchor: 0, head: 4 } });
    deleteBlankLines(view);
    expect(view.state.doc.toString()).toBe("A\nB\n\nC");
    view.destroy();
  });

  it("returns false when there's nothing blank to remove", () => {
    const view = makeView("A\nB\nC", 0);
    expect(deleteBlankLines(view)).toBe(false);
    view.destroy();
  });
});

describe("uppercaseSelection / lowercaseSelection", () => {
  it("uppercases a selection", () => {
    const view = makeView("select 1");
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    uppercaseSelection(view);
    expect(view.state.doc.toString()).toBe("SELECT 1");
    view.destroy();
  });

  it("with no selection, transforms the word under the cursor", () => {
    const view = makeView("select 1", 2);
    uppercaseSelection(view);
    expect(view.state.doc.toString()).toBe("SELECT 1");
    view.destroy();
  });

  it("lowercases a selection", () => {
    const view = makeView("SELECT 1");
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    lowercaseSelection(view);
    expect(view.state.doc.toString()).toBe("select 1");
    view.destroy();
  });

  it("returns false when already the target case", () => {
    const view = makeView("SELECT");
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    expect(uppercaseSelection(view)).toBe(false);
    view.destroy();
  });
});

describe("cycleNamingStyle", () => {
  it("cycles snake_case -> camelCase -> PascalCase -> snake_case", () => {
    expect(cycleNamingStyle("user_id")).toBe("userId");
    expect(cycleNamingStyle("userId")).toBe("UserId");
    expect(cycleNamingStyle("UserId")).toBe("user_id");
  });

  it("splits consecutive-caps acronyms as their own word", () => {
    expect(cycleNamingStyle("HTTPServer")).toBe("http_server");
  });

  it("leaves a non-identifier string alone", () => {
    expect(cycleNamingStyle("")).toBe("");
  });
});

describe("cycleSelectionNamingStyle", () => {
  it("cycles the identifier under the cursor with no selection", () => {
    const view = makeView("const user_id = 1", 8);
    cycleSelectionNamingStyle(view);
    expect(view.state.doc.toString()).toBe("const userId = 1");
    view.destroy();
  });
});

describe("pasteAsSqlInCondition", () => {
  it("reformats clipboard lines into a quoted, comma-joined IN list", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { readText: () => Promise.resolve("a\nb\n\nc's") },
    });
    const view = makeView("WHERE id IN ", 12);
    const claimed = pasteAsSqlInCondition(view);
    expect(claimed).toBe(true); // claims the keystroke synchronously
    await new Promise((r) => setTimeout(r, 0));
    expect(view.state.doc.toString()).toBe("WHERE id IN ('a', 'b', 'c''s')");
    view.destroy();
    vi.unstubAllGlobals();
  });
});
