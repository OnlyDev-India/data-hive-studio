import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";

const writeFile = vi.fn().mockResolvedValue(undefined);

vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  writeFile: (...args: unknown[]) => writeFile(...args),
}));

import { useUnsavedQueryTracking } from "../editor-tab";
import { FileBreadcrumb, useEditorScrolled } from "../file-breadcrumb";
import { useStudioStore } from "@/shared/store";

const KEY = "conn-1 sql-1";

function written(): string {
  const bytes = writeFile.mock.calls.at(-1)![1] as number[];
  return new TextDecoder().decode(new Uint8Array(bytes));
}

beforeEach(() => {
  writeFile.mockClear();
  useStudioStore.setState({ seedFilePaths: {}, sqlSeeds: {} });
});
afterEach(cleanup);

describe("saving a query tab", () => {
  it("writes an opened file back to its path without asking", async () => {
    useStudioStore.setState({
      seedFilePaths: { [KEY]: "/work/queries/report.sql" },
      sqlSeeds: { [KEY]: "select 1" },
    });
    const pick = vi.fn();
    const { result, rerender } = renderHook(
      ({ text }) => useUnsavedQueryTracking(KEY, text, vi.fn(), pick),
      { initialProps: { text: "select 1" } },
    );
    expect(result.current.file_name).toBe("report.sql");
    expect(result.current.is_dirty).toBe(false);

    rerender({ text: "select 2" });
    expect(result.current.is_dirty).toBe(true);
    await act(async () => {
      await result.current.save();
    });

    expect(pick).not.toHaveBeenCalled();
    expect(writeFile.mock.calls.at(-1)![0]).toBe("/work/queries/report.sql");
    expect(written()).toBe("select 2");
    expect(result.current.is_dirty).toBe(false);
  });

  it("asks for a path only the first time a new tab is saved", async () => {
    const pick = vi.fn().mockResolvedValue("/tmp/new.sql");
    const { result, rerender } = renderHook(
      ({ text }) => useUnsavedQueryTracking(KEY, text, vi.fn(), pick),
      { initialProps: { text: "select 1" } },
    );
    await act(async () => {
      await result.current.save();
    });
    expect(pick).toHaveBeenCalledOnce();
    expect(result.current.file_path).toBe("/tmp/new.sql");

    rerender({ text: "select 3" });
    await act(async () => {
      await result.current.save();
    });
    expect(pick).toHaveBeenCalledOnce();
    expect(writeFile.mock.calls.at(-1)![0]).toBe("/tmp/new.sql");
    expect(written()).toBe("select 3");
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    const pick = vi.fn().mockResolvedValue(null);
    const { result } = renderHook(() =>
      useUnsavedQueryTracking(KEY, "select 1", vi.fn(), pick),
    );
    let ok = true;
    await act(async () => {
      ok = await result.current.save();
    });
    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(result.current.file_path).toBeNull();
  });
});

describe("FileBreadcrumb", () => {
  it("shows each folder and the file name", () => {
    render(<FileBreadcrumb path="/Users/me/queries/report.sql" />);
    const crumb = screen.getByTestId("file-breadcrumb");
    expect(crumb.textContent).toBe("Usersmequeriesreport.sql");
    expect(crumb.getAttribute("title")).toBe("/Users/me/queries/report.sql");
  });

  it("sits on the editor's own background, not the app's", () => {
    render(<FileBreadcrumb path="/q/report.sql" />);
    // One Dark's editor background, #282c34.
    expect(screen.getByTestId("file-breadcrumb").style.backgroundColor).toBe(
      "rgb(40, 44, 52)",
    );
  });

  it("casts a shadow only once the editor scrolls off the top", () => {
    function Harness() {
      const { scrolled, onScrollCapture } = useEditorScrolled();
      return (
        <>
          <FileBreadcrumb path="/q/report.sql" scrolled={scrolled} />
          <div onScrollCapture={onScrollCapture}>
            <div className="cm-scroller" data-testid="scroller" />
          </div>
        </>
      );
    }
    render(<Harness />);
    const crumb = screen.getByTestId("file-breadcrumb");
    const scroller = screen.getByTestId("scroller");
    expect(crumb.style.boxShadow).toBe("");

    scroller.scrollTop = 40;
    fireEvent.scroll(scroller);
    expect(crumb.style.boxShadow).not.toBe("");

    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    expect(crumb.style.boxShadow).toBe("");
  });
});
