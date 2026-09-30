import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RowDiffGrid } from "../row-diff-grid";

// jsdom has no layout; give the virtualizer a box so rows render.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 900,
  });
});

afterEach(cleanup);

describe("RowDiffGrid null cells", () => {
  it("shows NULL for a null value and leaves a missing one blank", () => {
    render(
      <RowDiffGrid
        columns={["token", "name"]}
        rows={[
          {
            id: "1",
            kind: "update",
            before: { token: null, name: "a" },
            after: { name: "b" },
            changed: ["name"],
          },
        ]}
      />,
    );
    expect(screen.getAllByText("NULL")).toHaveLength(1);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
  });
});
