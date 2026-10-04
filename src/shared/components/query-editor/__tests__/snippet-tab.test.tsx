import { describe, it, expect } from "vitest";
import { useState } from "react";
import { act, render } from "@testing-library/react";
import { snippet } from "@codemirror/autocomplete";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { QueryEditor } from "../index";

function Host() {
  const [value, setValue] = useState("");
  return <QueryEditor value={value} onChange={setValue} />;
}

function selected(view: EditorView) {
  const { from, to } = view.state.selection.main;
  return view.state.sliceDoc(from, to);
}

function tab(view: EditorView) {
  runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key: "Tab" }),
    "editor",
  );
}

describe("QueryEditor snippets", () => {
  it("Tab moves through fields after the insert rerenders the editor", async () => {
    const { container } = render(<Host />);
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-editor") as HTMLElement,
    )!;
    await act(async () => {
      snippet("SELECT ${1:*} FROM ${2:table} LIMIT ${3:100};")(
        view,
        null as never,
        0,
        0,
      );
    });
    expect(selected(view)).toBe("*");
    await act(async () => tab(view));
    expect(selected(view)).toBe("table");
    await act(async () => tab(view));
    expect(selected(view)).toBe("100");
  });
});
