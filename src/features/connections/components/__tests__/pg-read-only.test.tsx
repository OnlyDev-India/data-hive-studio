import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { connectPostgres } = vi.hoisted(() => ({ connectPostgres: vi.fn() }));

vi.mock("@/shared/api/web", () => ({ WEB: false }));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  connectPostgres,
}));

import { useStudioStore } from "@/shared/store";
import type { SavedConnParams } from "@/shared/store";
import { Landing } from "../landing";

const base: SavedConnParams = {
  kind: "postgres",
  name: "Orders",
  host: "db.example",
  port: 5432,
  user: "app",
  password: "pw",
  database: "orders",
};

function prefill(params: SavedConnParams) {
  useStudioStore.setState({
    landingPrefill: { kind: "postgres", params, n: 1, connect: false },
  });
}

const readOnlySwitch = () => screen.getByRole("switch", { name: /read only/i });

beforeEach(() => {
  connectPostgres.mockReset().mockResolvedValue({
    id: "c1",
    name: "orders",
    kind: "postgres",
  });
  useStudioStore.setState({
    savedLocal: {},
    open: [],
    landingPrefill: null,
    serverSessions: {},
  });
});
afterEach(cleanup);

describe("Landing, PostgreSQL read only switch", () => {
  it("is off for a connection saved before read only existed", async () => {
    prefill(base);
    render(<Landing />);

    await screen.findByDisplayValue("db.example");
    expect(readOnlySwitch()).not.toBeChecked();
  });

  it("shows a saved read only connection as on", async () => {
    prefill({ ...base, read_only: true });
    render(<Landing />);

    await screen.findByDisplayValue("db.example");
    expect(readOnlySwitch()).toBeChecked();
  });

  it("sends read_only to the backend when connecting", async () => {
    prefill(base);
    render(<Landing />);
    await screen.findByDisplayValue("db.example");

    await userEvent.click(readOnlySwitch());
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(connectPostgres).toHaveBeenCalledOnce());
    expect(connectPostgres.mock.calls[0][0]).toMatchObject({
      host: "db.example",
      read_only: true,
    });
  });

  it("sends read_only false when the switch was never touched", async () => {
    prefill(base);
    render(<Landing />);
    await screen.findByDisplayValue("db.example");

    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(connectPostgres).toHaveBeenCalledOnce());
    expect(connectPostgres.mock.calls[0][0]).toMatchObject({
      read_only: false,
    });
  });
});
