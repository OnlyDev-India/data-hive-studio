import { describe, expect, it } from "vitest";
import {
  CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { fieldCompletions } from "../field-completions";

/** Completions for `doc` with the cursor at its end. */
function complete(
  fields: string[],
  doc: string,
  explicit = false,
): CompletionResult | null {
  const state = EditorState.create({
    doc,
    extensions: fieldCompletions(fields),
  });
  const [source] = state.languageDataAt<CompletionSource>(
    "autocomplete",
    doc.length,
  );
  return source(
    new CompletionContext(state, doc.length, explicit),
  ) as CompletionResult | null;
}

const fields = ["name", "address.zip", "first name"];

describe("fieldCompletions", () => {
  it("offers field references after a quoted $", () => {
    const doc = '{ _id: "$ad';
    const got = complete(fields, doc)!;
    expect(got.from).toBe(doc.indexOf("$"));
    expect(got.options.map((o) => o.label)).toEqual([
      "$name",
      "$address.zip",
      "$first name",
    ]);
  });

  it("offers field names at a key position, quoting the ones that need it", () => {
    const doc = "{ a: 1, na";
    const got = complete(fields, doc)!;
    expect(got.from).toBe(doc.length - 2);
    expect(got.options.map((o) => [o.label, o.apply])).toEqual([
      ["name", "name"],
      ["address.zip", '"address.zip"'],
      ["first name", '"first name"'],
    ]);
  });

  it("waits for typing at an empty key position unless asked", () => {
    expect(complete(fields, "{ a: 1, ")).toBeNull();
    expect(complete(fields, "{ a: 1, ", true)?.options).toHaveLength(3);
  });

  it("offers no keys in a value position", () => {
    expect(complete(fields, "{ a: na")).toBeNull();
  });

  it("offers nothing when there are no fields", () => {
    expect(complete([], '{ a: "$')).toBeNull();
    expect(complete([], "{ na", true)).toBeNull();
  });
});
