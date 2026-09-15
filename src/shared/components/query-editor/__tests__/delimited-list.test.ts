import { describe, it, expect } from "vitest";
import { buildDelimitedList } from "../delimited-list";

describe("buildDelimitedList", () => {
  it("splits on newline, quotes, and joins by default", () => {
    expect(
      buildDelimitedList("a\nb\nc", {
        splitOn: "\\n",
        quote: "'",
        joinWith: ", ",
      }),
    ).toBe("'a', 'b', 'c'");
  });

  it("drops blank lines and trims whitespace", () => {
    expect(
      buildDelimitedList("a\n\n  b  \n", {
        splitOn: "\\n",
        quote: "'",
        joinWith: ", ",
      }),
    ).toBe("'a', 'b'");
  });

  it("doubles an internal occurrence of the quote character", () => {
    expect(
      buildDelimitedList("it's", {
        splitOn: "\\n",
        quote: "'",
        joinWith: ", ",
      }),
    ).toBe("'it''s'");
  });

  it("supports a literal custom separator (comma)", () => {
    expect(
      buildDelimitedList("a,b,c", { splitOn: ",", quote: "", joinWith: " | " }),
    ).toBe("a | b | c");
  });

  it("supports tab as the split separator via its escape form", () => {
    expect(
      buildDelimitedList("a\tb\tc", {
        splitOn: "\\t",
        quote: "",
        joinWith: ",",
      }),
    ).toBe("a,b,c");
  });

  it("passes items through unquoted when quote is empty", () => {
    expect(
      buildDelimitedList("a\nb", { splitOn: "\\n", quote: "", joinWith: "," }),
    ).toBe("a,b");
  });
});
