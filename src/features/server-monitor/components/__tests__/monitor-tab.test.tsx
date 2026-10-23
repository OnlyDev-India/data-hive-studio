import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { KillRequest, MonitorSnapshot, SessionRow } from "@/shared/api";

const snapshotCall = vi.fn<(connId: string) => Promise<MonitorSnapshot>>();
const killCall = vi.fn<(connId: string, req: KillRequest) => Promise<unknown>>();

vi.mock("@/shared/api/web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/web")>()),
  WEB: false,
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  monitorSnapshot: (connId: string) => snapshotCall(connId),
  monitorKill: (connId: string, req: KillRequest) => killCall(connId, req),
  monitorKillLocked: () => Promise.resolve(false),
}));
// CodeMirror needs layout APIs jsdom lacks; the detail pane only needs text.
vi.mock("@/shared/components/query-editor", () => ({
  QueryEditor: ({ value }: { value: string }) => <pre data-testid="query">{value}</pre>,
}));

import { useStudioStore } from "@/shared/store";
import { MonitorTab } from "../monitor-tab";

const conn = { id: "c1", name: "shop", kind: "postgres" } as const;

function row(p: Partial<SessionRow> & Pick<SessionRow, "id">): SessionRow {
  return {
    user: "app",
    database: "shop",
    state: "active",
    query_ms: 100,
    xact_ms: null,
    backend_start: "2026-10-14 09:00:00.1+00",
    wait: null,
    op_type: null,
    query: "SELECT 1",
    query_hidden: false,
    client: null,
    app_name: null,
    is_this_app: false,
    shard: null,
    run_id: null,
    can_cancel: true,
    can_terminate: true,
    ...p,
  };
}

const SNAP: MonitorSnapshot = {
  taken_at: "2026-10-14T09:00:00.000Z",
  engine: "postgres",
  server_version: "16.4 (Debian 16.4-1)",
  node_note: null,
  app_name_self: "DH Studio (ab12)",
  visibility: { level: "partial", missing: ["pg_read_all_stats"] },
  counts: {
    total: 3,
    active: 1,
    idle: 0,
    idle_in_tx: 1,
    waiting: 1,
    blocked: 1,
    slow_at_5s: 1,
  },
  total_sessions: 3,
  sessions: [
    row({ id: "4821", query: "SELECT pg_sleep(30)", query_ms: 9000, is_this_app: true }),
    row({ id: "77", state: "idle_in_tx", xact_ms: 60_000, query: "UPDATE orders SET x = 1" }),
    row({ id: "78", state: "waiting", query_ms: 3000, query: null, query_hidden: true, user: "bob" }),
  ],
  blocks: [
    { waiter_id: "78", blocker_id: "77", lock_mode: "ShareLock", relation: "orders", wait_ms: 3000 },
  ],
};

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// The virtualized list renders only the rows that fit; jsdom has no layout.
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

beforeEach(() => {
  snapshotCall.mockReset().mockResolvedValue(SNAP);
  killCall.mockReset().mockResolvedValue({ result: "done", message: null });
  useStudioStore.setState({
    open: [conn],
    activeId: conn.id,
    view: "workspace",
    monitorSettings: {},
    workspaces: {},
    recentParams: {},
  });
});

describe("MonitorTab", () => {
  it("shows the counts, the sessions longest first, the tags and the privileges banner", async () => {
    render(<MonitorTab conn_id="c1" tab_key="monitor" active />);
    await settle();
    expect(screen.getByRole("heading", { name: "Server monitor" })).toBeInTheDocument();
    expect(screen.getByText(/shop · 16\.4$/)).toBeInTheDocument();
    const counts = screen.getByRole("group", { name: "Server counts" });
    expect(within(counts).getByText("Blocked").nextSibling).toHaveTextContent("1");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([
      "77",
      "4821",
      "78",
    ]);
    expect(within(rows[1]).getByText("This app")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Hidden by the server")).toBeInTheDocument();
    expect(screen.getByText(/GRANT pg_read_all_stats TO your_role;/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Locks/ })).toHaveTextContent("1");
  });

  it("freezes while a row is open, shows its detail, and resumes on Escape (AC-8, AC-9)", async () => {
    render(<MonitorTab conn_id="c1" tab_key="monitor" active />);
    await settle();
    const target = screen.getAllByRole("row").find((r) => r.textContent?.includes("4821"));
    fireEvent.click(target!);
    expect(screen.getByRole("complementary", { name: "Session 4821" })).toBeInTheDocument();
    expect(screen.getByTestId("query")).toHaveTextContent("SELECT pg_sleep(30)");
    expect(screen.getByRole("button", { name: /Paused while you look/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Session 4821" }), { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Session 4821" })).toBeNull();
  });

  it("cancels a query only after the confirm, sending the session's start time (AC-12, AC-13)", async () => {
    render(<MonitorTab conn_id="c1" tab_key="monitor" active />);
    await settle();
    const target = screen.getAllByRole("row").find((r) => r.textContent?.includes("4821"));
    fireEvent.click(target!);
    const detail = screen.getByRole("complementary", { name: "Session 4821" });
    fireEvent.click(within(detail).getByRole("button", { name: "Cancel query…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("SELECT pg_sleep(30)");
    expect(dialog).toHaveTextContent("This may be one of your own editor runs");
    expect(killCall).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /Cancel query/ }));
    await settle();
    expect(killCall).toHaveBeenCalledWith("c1", {
      action: "cancel",
      id: "4821",
      backend_start: "2026-10-14 09:00:00.1+00",
      run_id: null,
    });
  });

  it("shows the blocking tree on the Locks tab (AC-7)", async () => {
    render(<MonitorTab conn_id="c1" tab_key="monitor" active />);
    await settle();
    fireEvent.click(screen.getByRole("tab", { name: /Locks/ }));
    expect(screen.getByText(/Blocking 1 session$/)).toBeInTheDocument();
    expect(screen.getByText(/Waiting 3\.0s for/)).toHaveTextContent("ShareLock on orders");
  });

  it("says when the server cannot be monitored, with Retry (AC-16)", async () => {
    snapshotCall.mockRejectedValue(
      new Error("Server monitor unavailable: the server monitor needs PostgreSQL 10 or newer."),
    );
    render(<MonitorTab conn_id="c1" tab_key="monitor" active />);
    await settle();
    expect(screen.getByRole("heading", { name: "Can't monitor this server" })).toBeInTheDocument();
    expect(screen.getByText(/needs PostgreSQL 10 or newer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });
});
