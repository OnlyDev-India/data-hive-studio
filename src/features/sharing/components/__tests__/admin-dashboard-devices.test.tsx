import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeviceSession } from "@/shared/api/server-sessions";

const api = vi.hoisted(() => ({
  serversOrgMembers: vi.fn(),
  serversOrgInvitesList: vi.fn(),
  serversOrgAudit: vi.fn(),
  serversSessionsList: vi.fn(),
  serversSessionEnd: vi.fn(),
}));
vi.mock("@/shared/api/client", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/client")>()),
  serversOrgMembers: api.serversOrgMembers,
  serversOrgInvitesList: api.serversOrgInvitesList,
  serversOrgAudit: api.serversOrgAudit,
}));
vi.mock("@/shared/api/server-sessions", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-sessions")>()),
  serversSessionsList: api.serversSessionsList,
  serversSessionEnd: api.serversSessionEnd,
}));

import { useStudioStore } from "@/shared/store";
import { AdminDashboard } from "../admin-dashboard";

const THIS_DEVICE: DeviceSession = {
  id: "s1",
  device_name: "Ada's MacBook",
  platform: "desktop",
  created_ms: 0,
  last_used_ms: Date.now(),
  current: true,
};

const session = (id: string, url: string) =>
  ({
    profile: { id, name: id, url, org_id: "o1" },
    me: {},
    connIds: [],
  }) as never;

const disconnectServer = vi.fn();

beforeEach(() => {
  api.serversOrgMembers.mockReset().mockResolvedValue([]);
  api.serversOrgInvitesList.mockReset().mockResolvedValue([]);
  api.serversOrgAudit.mockReset().mockResolvedValue([]);
  api.serversSessionsList.mockReset().mockResolvedValue([THIS_DEVICE]);
  api.serversSessionEnd.mockReset().mockResolvedValue(true);
  disconnectServer.mockReset().mockResolvedValue(undefined);
  useStudioStore.setState({
    serverSessions: {
      p1: session("p1", "https://db.acme.com"),
      p2: session("p2", "https://db.acme.com"),
      p3: session("p3", "https://other.example.com"),
    },
    disconnectServer,
  });
});
afterEach(cleanup);

describe("AdminDashboard My devices tab", () => {
  it("shows the caller's devices under a My devices tab", async () => {
    render(<AdminDashboard profileId="p1" orgId="o1" />);
    await userEvent.click(screen.getByRole("tab", { name: "My devices" }));
    expect(await screen.findByText("Ada's MacBook")).toBeVisible();
    expect(api.serversSessionsList).toHaveBeenCalledWith("p1");
  });

  it("drops every profile on the same server when this device signs out", async () => {
    render(<AdminDashboard profileId="p1" orgId="o1" />);
    await userEvent.click(screen.getByRole("tab", { name: "My devices" }));
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out Ada's MacBook" }),
    );
    await waitFor(() => expect(disconnectServer).toHaveBeenCalledTimes(2));
    expect(disconnectServer).toHaveBeenCalledWith("p1");
    expect(disconnectServer).toHaveBeenCalledWith("p2");
    expect(disconnectServer).not.toHaveBeenCalledWith("p3");
  });
});
