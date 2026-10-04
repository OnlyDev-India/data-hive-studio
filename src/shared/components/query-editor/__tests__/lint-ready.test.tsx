import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryEditor } from "../index";

// Line 1 lints without any table list; line 2 only with one.
const SQL = "SELECT *;\nSELECT * FROM sales.orders;";
const HANDLERS = { onChange: () => {}, onRun: () => {}, onRunTarget: () => {} };

function inlineMessages(container: HTMLElement) {
  return [...container.querySelectorAll(".cm-inline-diagnostic")].map((el) =>
    el.textContent?.trim(),
  );
}

describe("QueryEditor lintReady", () => {
  it("holds unknown table checks while the table list is a placeholder", async () => {
    const { container } = render(
      <QueryEditor
        {...HANDLERS}
        value={SQL}
        tables={["users"]}
        lintReady={false}
      />,
    );
    await waitFor(
      () =>
        expect(inlineMessages(container)).toEqual([
          '"SELECT *" requires a FROM clause',
        ]),
      { timeout: 3000 },
    );
  });

  it("runs them once the list is real", async () => {
    const { container } = render(
      <QueryEditor {...HANDLERS} value={SQL} tables={["users"]} />,
    );
    await waitFor(
      () =>
        expect(inlineMessages(container)).toEqual([
          '"SELECT *" requires a FROM clause',
          'Unknown table "sales.orders"',
        ]),
      { timeout: 3000 },
    );
  });
});
