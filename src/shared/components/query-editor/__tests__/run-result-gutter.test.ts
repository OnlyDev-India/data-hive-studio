import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markRunResult, statementGutter } from "../statement-runner";

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function mount(doc: string) {
  view = new EditorView({
    state: EditorState.create({ doc, extensions: [statementGutter(() => {})] }),
    parent: document.body,
  });
  return view;
}

const marker = (v: EditorView) =>
  v.dom.querySelector<HTMLElement>(".cm-statement-run");

describe("run result gutter badge", () => {
  it("shows a red cross on a statement that failed", () => {
    const v = mount("select nope");
    markRunResult(v, { from: 0, to: 11 }, "error");
    expect(marker(v)?.className).toContain("cm-statement-run--error");
    expect(marker(v)?.querySelector(".cm-statement-run-badge")).not.toBeNull();
  });

  it("shows the check on a statement that succeeded", () => {
    const v = mount("select 1");
    markRunResult(v, { from: 0, to: 8 });
    expect(marker(v)?.className).toContain("cm-statement-run--success");
  });

  it("clears the badge when the run is stopped", () => {
    const v = mount("select 1");
    markRunResult(v, { from: 0, to: 8 }, "error");
    markRunResult(v, null);
    expect(marker(v)?.className).toBe("cm-statement-run");
  });
});
