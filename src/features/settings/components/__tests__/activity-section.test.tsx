import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockTauriCore } from "@/test/mock-tauri";

const { setSaveAppActivity, flags } = vi.hoisted(() => ({
  setSaveAppActivity: vi.fn(() => Promise.resolve()),
  flags: { web: false },
}));
vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/web")>()),
  get WEB() {
    return flags.web;
  },
}));
vi.mock("@tauri-apps/api/core", () => mockTauriCore());
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  setSaveAppActivity,
}));

import { useStudioStore } from "@/shared/store";
import { ActivitySection } from "../activity-section";

describe("Activity log settings", () => {
  beforeEach(() => {
    setSaveAppActivity.mockClear();
    useStudioStore.setState({ saveAppActivity: false });
  });

  it("starts off and pushes each change to the backend", () => {
    render(<ActivitySection />);
    const toggle = screen.getByRole("switch", { name: "Save app queries" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    expect(useStudioStore.getState().saveAppActivity).toBe(true);
    expect(setSaveAppActivity).toHaveBeenCalledWith(true);
  });

  it.each([
    [false, true],
    [true, false],
  ])("web %s lists the section: %s", async (web, listed) => {
    flags.web = web;
    vi.resetModules();
    const { SECTIONS } = await import("../settings-dialog");
    expect(SECTIONS.some((s) => s.label === "Activity log")).toBe(listed);
    flags.web = false;
  });
});
