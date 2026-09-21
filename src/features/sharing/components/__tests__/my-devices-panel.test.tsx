import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DeviceSession } from "@/shared/api/server-sessions";

const api = vi.hoisted(() => ({
  serversSessionsList: vi.fn(),
  serversSessionEnd: vi.fn(),
  serversSessionsEndAll: vi.fn(),
}));
vi.mock("@/shared/api/server-sessions", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-sessions")>()),
  ...api,
}));

import { MyDevicesPanel, lastUsedLabel } from "../my-devices-panel";

const NOW = Date.now();
const device = (over: Partial<DeviceSession>): DeviceSession => ({
  id: "s1",
  device_name: "Ada's MacBook",
  platform: "desktop",
  created_ms: NOW - 86_400_000,
  last_used_ms: NOW - 5 * 60_000,
  current: false,
  ...over,
});

const DEVICES = [
  device({ id: "s1", device_name: "Ada's MacBook", current: true }),
  device({
    id: "s2",
    device_name: "Chrome on Windows",
    platform: "web",
    last_used_ms: NOW - 3 * 86_400_000,
  }),
];

function setup() {
  const onSignedOut = vi.fn();
  render(
    <MyDevicesPanel
      profileId="p1"
      serverName="db.acme.com"
      onSignedOut={onSignedOut}
    />,
  );
  return { onSignedOut };
}

beforeEach(() => {
  api.serversSessionsList.mockReset().mockResolvedValue(DEVICES);
  api.serversSessionEnd.mockReset();
  api.serversSessionsEndAll.mockReset();
});
afterEach(cleanup);

describe("MyDevicesPanel", () => {
  it("lists every device with a mark on this one", async () => {
    setup();
    expect(screen.getByText(/Loading your devices/)).toBeVisible();
    const list = await screen.findByRole("list", { name: "Devices" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Ada's MacBook")).toBeVisible();
    expect(within(rows[0]).getByText("This device")).toBeVisible();
    expect(within(rows[1]).getByText("Chrome on Windows")).toBeVisible();
    expect(within(rows[1]).queryByText("This device")).toBeNull();
    expect(
      within(rows[1]).getByText(/Web · Last used 3 days ago/),
    ).toBeVisible();
    expect(api.serversSessionsList).toHaveBeenCalledWith("p1");
  });

  it("shows an error with a way to try again", async () => {
    api.serversSessionsList.mockRejectedValueOnce(new Error("offline"));
    setup();
    expect(await screen.findByText(/Couldn't load your devices/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Devices" })).toBeVisible();
  });

  it("signs out one other device and leaves the rest of the list alone", async () => {
    api.serversSessionEnd.mockResolvedValue(false);
    const { onSignedOut } = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out Chrome on Windows" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Chrome on Windows")).toBeNull(),
    );
    expect(api.serversSessionEnd).toHaveBeenCalledWith("p1", DEVICES[1]);
    expect(screen.getByText("Ada's MacBook")).toBeVisible();
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it("reports a sign out when this device ends itself", async () => {
    api.serversSessionEnd.mockResolvedValue(true);
    const { onSignedOut } = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out Ada's MacBook" }),
    );
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
  });

  it("asks before signing out everywhere, and only then does it", async () => {
    api.serversSessionsEndAll.mockResolvedValue(undefined);
    const { onSignedOut } = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out everywhere" }),
    );
    // Nothing has happened yet: the confirm is showing.
    expect(api.serversSessionsEndAll).not.toHaveBeenCalled();
    expect(screen.getByText(/signs out every device/)).toBeVisible();

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out everywhere" }),
    );
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(api.serversSessionsEndAll).toHaveBeenCalledWith("p1");
  });

  it("can back out of signing out everywhere", async () => {
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out everywhere" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.serversSessionsEndAll).not.toHaveBeenCalled();
    expect(screen.queryByText(/signs out every device/)).toBeNull();
  });

  it("says so when a sign out fails", async () => {
    api.serversSessionEnd.mockRejectedValueOnce(new Error("boom"));
    setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Sign out Chrome on Windows" }),
    );
    expect(
      await screen.findByText(/Couldn't sign that device out/),
    ).toBeVisible();
    expect(screen.getByText("Chrome on Windows")).toBeVisible();
  });
});

describe("lastUsedLabel", () => {
  it("reads in plain words", () => {
    expect(lastUsedLabel(NOW - 20_000, NOW)).toBe("Just now");
    expect(lastUsedLabel(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(lastUsedLabel(NOW - 60 * 60_000, NOW)).toBe("1 hour ago");
    expect(lastUsedLabel(NOW - 5 * 3_600_000, NOW)).toBe("5 hours ago");
    expect(lastUsedLabel(NOW - 86_400_000, NOW)).toBe("1 day ago");
    expect(lastUsedLabel(NOW - 12 * 86_400_000, NOW)).toBe("12 days ago");
  });
});
