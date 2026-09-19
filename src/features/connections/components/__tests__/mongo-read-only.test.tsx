import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { connectMongo } = vi.hoisted(() => ({ connectMongo: vi.fn() }));

vi.mock("@/shared/api/web", () => ({ WEB: false }));
// Saving goes to the keychain backed Tauri command; the store keeps the record.
vi.mock("@/shared/api/local-connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api/local-connections")>()),
  saveLocalConnection: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  connectMongo,
}));

import { useStudioStore } from "@/shared/store";
import type { SavedConnParams } from "@/shared/store";
import { Landing } from "../landing";

const base: SavedConnParams = {
  kind: "mongodb",
  name: "Shop",
  host: "mongo.example",
  port: 27017,
  user: "app",
  password: "pw",
  database: "shop",
};

function prefill(params: SavedConnParams) {
  useStudioStore.setState({
    landingPrefill: { kind: "mongodb", params, n: 1, connect: false },
  });
}

const readOnlySwitch = () => screen.getByRole("switch", { name: /read only/i });

beforeEach(() => {
  connectMongo.mockReset().mockResolvedValue({
    id: "m1",
    name: "shop",
    kind: "mongodb",
  });
  useStudioStore.setState({
    savedLocal: {},
    open: [],
    landingPrefill: null,
    serverSessions: {},
  });
});
afterEach(cleanup);

describe("Landing, MongoDB read only switch", () => {
  it("is off for a connection saved before read only existed", async () => {
    prefill(base);
    render(<Landing />);

    await screen.findByDisplayValue("mongo.example");
    expect(readOnlySwitch()).not.toBeChecked();
  });

  it("shows a saved read only connection as on", async () => {
    prefill({ ...base, read_only: true });
    render(<Landing />);

    await screen.findByDisplayValue("mongo.example");
    expect(readOnlySwitch()).toBeChecked();
  });

  it("sends read_only to the backend when connecting", async () => {
    prefill(base);
    render(<Landing />);
    await screen.findByDisplayValue("mongo.example");

    await userEvent.click(readOnlySwitch());
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(connectMongo).toHaveBeenCalledOnce());
    expect(connectMongo.mock.calls[0][0]).toMatchObject({
      host: "mongo.example",
      read_only: true,
    });
  });

  it("sends read_only false when the switch was never touched", async () => {
    prefill(base);
    render(<Landing />);
    await screen.findByDisplayValue("mongo.example");

    await userEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(connectMongo).toHaveBeenCalledOnce());
    expect(connectMongo.mock.calls[0][0]).toMatchObject({ read_only: false });
  });

  it("saves the flag with the connection", async () => {
    prefill(base);
    render(<Landing />);
    await screen.findByDisplayValue("mongo.example");

    await userEvent.click(readOnlySwitch());
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(useStudioStore.getState().savedLocal["Shop"]).toBeDefined(),
    );
    expect(useStudioStore.getState().savedLocal["Shop"]).toMatchObject({
      kind: "mongodb",
      read_only: true,
    });
  });
});
