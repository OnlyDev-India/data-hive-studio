import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResultViewTabs } from "../result-view-tabs";

describe("ResultViewTabs", () => {
  it("shows each tab as an icon only until it is selected", async () => {
    const on_change = vi.fn();
    const { rerender } = render(
      <ResultViewTabs active="result" on_change={on_change} />,
    );
    expect(screen.getByRole("button", { name: "Result" }).textContent).toBe(
      "Result",
    );
    const summary = screen.getByRole("button", { name: "Summary" });
    expect(summary.textContent).toBe("");
    await userEvent.click(summary);
    expect(on_change).toHaveBeenCalledWith("summary");
    rerender(<ResultViewTabs active="summary" on_change={on_change} />);
    expect(screen.getByRole("button", { name: "Summary" }).textContent).toBe(
      "Summary",
    );
    expect(screen.getByRole("button", { name: "Result" }).textContent).toBe("");
  });
});
