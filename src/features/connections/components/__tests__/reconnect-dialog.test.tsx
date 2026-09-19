import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { tabKey, useStudioStore } from "@/shared/store";
import { ReconnectDialog } from "../reconnect-dialog";

beforeEach(() =>
  useStudioStore.setState({ workspaces: {}, schemaEdits: {}, gridBridges: {} }),
);
afterEach(cleanup);

const props = () => ({
  busy: false,
  onReconnect: vi.fn(),
  onLater: vi.fn(),
});

describe("ReconnectDialog", () => {
  it("is closed when there is nothing to offer", () => {
    render(<ReconnectDialog conn_ids={null} {...props()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Reconnect now and Later, and says the old settings hold until then", async () => {
    const p = props();
    render(<ReconnectDialog conn_ids={["c1"]} {...p} />);

    expect(screen.getByRole("dialog")).toHaveTextContent(
      /keeps its old settings/i,
    );
    // Nothing unapplied: no list of lost work.
    expect(screen.queryByText(/would be lost/i)).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: /reconnect now/i }),
    );
    expect(p.onReconnect).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /later/i }));
    expect(p.onLater).toHaveBeenCalled();
  });

  it("lists staged grid edits and unsaved editor text for that connection only", () => {
    const users = { kind: "table", tabId: 1, name: "users" } as const;
    const other = { kind: "table", tabId: 2, name: "other" } as const;
    const query = { kind: "sql", conn_id: "c1", id: 0 } as const;
    useStudioStore.setState({
      workspaces: {
        c1: { tabs: [users, query] },
        c2: { tabs: [other] },
      },
      gridBridges: {
        [tabKey(users)]: { pending_exists: true, pending_count: 3 },
        [tabKey(other)]: { pending_exists: true, pending_count: 9 },
      },
      sqlTabs: { [tabKey(query)]: { is_dirty: true } },
    } as never);

    render(<ReconnectDialog conn_ids={["c1"]} {...props()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/3 unsaved row edits/);
    expect(dialog).toHaveTextContent(/unsaved queries/);
    expect(dialog).not.toHaveTextContent(/9 unsaved/);
  });

  it("cannot be dismissed while reconnecting", () => {
    render(<ReconnectDialog conn_ids={["c1"]} {...props()} busy />);
    expect(
      screen.getByRole("button", { name: /reconnecting/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /later/i })).toBeDisabled();
  });
});
