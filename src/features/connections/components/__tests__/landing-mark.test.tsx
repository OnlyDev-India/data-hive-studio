import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@tauri-apps/api/core", () => mockTauriCore());

async function loadLanding() {
  const [{ Landing }, { useConnectionDrafts }] = await Promise.all([
    import("../landing"),
    import("../../lib/drafts"),
  ]);
  useConnectionDrafts.getState().reset();
  return Landing;
}

const bands = () => [...document.querySelectorAll("[data-band]")];

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(cleanup);

describe("landing brand mark", () => {
  it("shows no mark without showMark", async () => {
    const Landing = await loadLanding();
    render(<Landing />);
    expect(screen.queryByTestId("brand-mark")).toBeNull();
  });

  it("shows the mark on the picker step and still on the form step", async () => {
    const Landing = await loadLanding();
    render(<Landing showMark />);
    expect(screen.getByTestId("brand-mark")).toHaveClass("size-18");
    await userEvent.click(screen.getByRole("radio", { name: "PostgreSQL" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByLabelText("Host")).toBeInTheDocument();
    expect(screen.getByTestId("brand-mark")).toBeInTheDocument();
  });

  it("plays the entrance on the first mount only", async () => {
    const Landing = await loadLanding();
    const first = render(<Landing showMark />);
    for (const band of bands()) expect(band).toHaveClass("animate-mark-enter");
    first.unmount();

    render(<Landing showMark />);
    for (const band of bands())
      expect(band).not.toHaveClass("animate-mark-enter");
  });

  it("keeps the entrance for the empty studio when the overlay mounts first", async () => {
    const Landing = await loadLanding();
    render(<Landing />).unmount();
    render(<Landing showMark />);
    for (const band of bands()) expect(band).toHaveClass("animate-mark-enter");
  });

  it("hides the mark on short windows and sits beside the card, not in it", async () => {
    const Landing = await loadLanding();
    render(<Landing showMark />);
    const mark = screen.getByTestId("brand-mark");
    expect(mark).toHaveClass("shrink-0", "[@media(max-height:719px)]:hidden");
    expect(mark.parentElement).toHaveClass("min-h-0", "max-h-full");
    expect(mark.parentElement).toContainElement(
      screen.getByRole("radio", { name: "PostgreSQL" }),
    );
  });
});
