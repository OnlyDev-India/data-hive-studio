import { describe, expect, it } from "vitest";
import { countLabel, docLine, docsText, docText } from "../format";

describe("countLabel", () => {
  it("names the cap only when the cap cut the input", () => {
    const cap = (1000).toLocaleString();
    expect(countLabel(37, 1000, true)).toBe(`37 of first ${cap}`);
    expect(countLabel(37, 1000, false)).toBe("37");
  });

  it("formats large counts with the locale's separators", () => {
    expect(countLabel(12345, 100000, false)).toBe((12345).toLocaleString());
  });
});

describe("document text", () => {
  const doc = {
    _id: { $oid: "507f1f77bcf86cd799439011" },
    nested: { a: 1, b: [1, 2] },
  };

  it("shows ObjectIds in the shell's own syntax", () => {
    expect(docText(doc)).toContain('ObjectId("507f1f77bcf86cd799439011")');
  });

  it("puts a whole document on one line for a collapsed card", () => {
    const line = docLine(doc);
    expect(line).not.toContain("\n");
    expect(line.replace(/\s+/g, "")).toBe(docText(doc).replace(/\s+/g, ""));
  });

  it("joins documents one after another", () => {
    expect(docsText([{ a: 1 }, { b: 2 }])).toBe(
      `${docText({ a: 1 })}\n${docText({ b: 2 })}`,
    );
    expect(docsText([])).toBe("");
  });
});
