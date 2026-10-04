import { describe, expect, it } from "vitest";
import { newStage } from "../../model";
import { codeInput, driverCode, type DriverLang } from "..";
import input from "./fixtures/pipeline.json";
import node from "./fixtures/node.js.txt?raw";
import python from "./fixtures/python.py.txt?raw";
import java from "./fixtures/java.java.txt?raw";
import go from "./fixtures/go.go.txt?raw";

describe("driverCode", () => {
  const fixtures: [DriverLang, string][] = [
    ["node", node],
    ["python", python],
    ["java", java],
    ["go", go],
  ];
  it.each(fixtures)("%s matches its stored fixture", (lang, expected) => {
    expect(driverCode(lang, input)).toBe(expected);
  });

  it("writes plain numbers that fit an int and keeps the rest typed", () => {
    const code = driverCode("node", {
      collection: "c",
      stages: [
        {
          stage: {
            $match: {
              n: { $numberLong: "-2147483649" },
              i: { $numberInt: "3" },
            },
          },
          comments: [],
        },
      ],
    });
    expect(code).toContain('Long.fromString("-2147483649")');
    expect(code).toContain("i: 3");
  });

  it("falls back to a quoted Go string when the JSON holds a backtick", () => {
    const code = driverCode("go", {
      collection: "c",
      stages: [{ stage: { $match: { a: "x`y" } }, comments: [] }],
    });
    expect(code).toContain('pipelineJSON := "[\\n');
  });
});

describe("codeInput", () => {
  it("pairs titles and notes with the enabled cards, never disabled ones", () => {
    const off = { ...newStage("$sort"), enabled: false, title: "Off" };
    const on = { ...newStage("$limit"), title: "Ten", note: "a\nb" };
    const got = codeInput([{ $limit: 10 }], "c", [off, on]);
    expect(got.stages).toEqual([
      { stage: { $limit: 10 }, comments: ["Ten", "a", "b"] },
    ]);
  });

  it("leaves comments out when the cards no longer line up", () => {
    const on = { ...newStage("$limit"), title: "Ten" };
    const got = codeInput([{ $limit: 10 }, { $skip: 1 }], "c", [on]);
    expect(got.stages.every((s) => s.comments.length === 0)).toBe(true);
  });
});
