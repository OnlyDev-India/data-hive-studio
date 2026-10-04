import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ZoomControls } from "../canvas-controls";

describe("ZoomControls", () => {
  it("puts the top slot in the same card, above the zoom buttons", () => {
    render(
      <ReactFlowProvider>
        <ZoomControls
          onZoomIn={() => {}}
          onZoomOut={() => {}}
          onFit={() => {}}
          top={<button aria-label="Undo" />}
        />
      </ReactFlowProvider>,
    );
    const group = screen.getByRole("group", { name: "Zoom" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Undo",
      "Zoom in",
      "Zoom out",
      "Fit to screen",
    ]);
  });
});
