import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "@/shared/components/ui/resizable";
import { useStudioStore } from "@/shared/store";
import { useBottomPanelSize } from "../use-bottom-panel-size";

const CONN = "c1";
const TAB = "t1";
const SCOPE = `${CONN}\u0000${TAB}`;

// jsdom has no layout engine and no ResizeObserver; the library needs both to
// size panels, so give it a fixed 1000px box to measure.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 1000,
  });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      width: 1000,
      height: 1000,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
    }) as DOMRect;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  useStudioStore.setState({ bottomPanelOpen: {} });
});

/** Mirrors `TablePane`/`MongoCollectionPane`: the hook lives in the pane, but
 *  the panel group only mounts once the schema has loaded (`ready`). */
function Pane({ ready }: { ready: boolean }) {
  const { panelRef, defaultLayout, defaultSize, onLayoutChanged } =
    useBottomPanelSize({
      conn_id: CONN,
      tab_key: TAB,
      panelIds: ["top-panel", "bottom-panel"],
      storage: localStorage,
    });
  return ready ? (
    <div style={{ height: 1000 }}>
      <ResizablePanelGroup
        orientation="vertical"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel id="top-panel" minSize="30%">
          top
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
          id="bottom-panel"
          defaultSize={defaultSize}
          minSize={0}
          collapsible
          collapsedSize={0}
          panelRef={panelRef}
        >
          bottom
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  ) : null;
}

/** The bottom panel's share of the group, read from the DOM the library
 *  renders (0 when collapsed). */
function bottomGrow(container: HTMLElement) {
  const el = container.querySelector<HTMLElement>(
    '[data-panel][id="bottom-panel"]',
  );
  return Number(el?.style.flexGrow);
}

describe("useBottomPanelSize", () => {
  it("starts collapsed even when the panel mounts after the pane does", () => {
    // Pane mounts first (schema still loading), panel group mounts later.
    const { rerender, container } = render(<Pane ready={false} />);
    act(() => {
      rerender(<Pane ready />);
    });
    expect(bottomGrow(container)).toBe(0);
  });

  it("starts collapsed when the panel is there from the first render", () => {
    const { container } = render(<Pane ready />);
    expect(bottomGrow(container)).toBe(0);
  });

  it("expands when the store says this tab's panel is open", () => {
    useStudioStore.setState({ bottomPanelOpen: { [SCOPE]: true } });
    const { rerender, container } = render(<Pane ready={false} />);
    act(() => {
      rerender(<Pane ready />);
    });
    expect(bottomGrow(container)).toBeGreaterThan(0);
  });
});
