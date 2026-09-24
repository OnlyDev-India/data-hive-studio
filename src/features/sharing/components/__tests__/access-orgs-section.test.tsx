import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServerOrg } from "@/shared/api/server-access";
import { useStudioStore } from "@/shared/store";
import type { StudioStore } from "@/shared/store/types";

const api = vi.hoisted(() => ({
  serverOrgsList: vi.fn(),
  serverSettingsGet: vi.fn(),
  serverSetOpenOrgCreation: vi.fn(),
}));
vi.mock("@/shared/api/server-access", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-access")>()),
  ...api,
}));
// Store changes schedule a debounced workspace save; keep it off Tauri IPC.
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { AccessOrgsSection } from "../access-orgs-section";

const org = (over: Partial<ServerOrg>): ServerOrg => ({
  id: "o1",
  name: "Acme",
  slug: "acme",
  created_ms: 1,
  created_by: "admin@x.com",
  member_count: 3,
  owners: ["admin@x.com"],
  ...over,
});

let original_push_notification: StudioStore["pushNotification"];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.serverOrgsList.mockResolvedValue([
    org({}),
    org({ id: "o2", name: "Old", created_by: null, member_count: 1 }),
  ]);
  api.serverSettingsGet.mockResolvedValue({ open_org_creation: false });
  api.serverSetOpenOrgCreation.mockResolvedValue(undefined);
  original_push_notification = useStudioStore.getState().pushNotification;
});
afterEach(() => {
  cleanup();
  useStudioStore.setState({ pushNotification: original_push_notification });
});

describe("AccessOrgsSection", () => {
  it("lists every org with owners, creator and member count", async () => {
    render(<AccessOrgsSection profileId="p1" />);
    expect(await screen.findByText("Acme")).toBeVisible();
    expect(
      screen.getByText(/Owners: admin@x.com · Created by admin@x.com/),
    ).toBeVisible();
    expect(screen.getByText("3 members")).toBeVisible();
    // An org from before creators were tracked, with one member.
    expect(screen.getByText(/Created by unknown/)).toBeVisible();
    expect(screen.getByText("1 member")).toBeVisible();
  });

  it("turns the open org creation policy on and tells the server", async () => {
    render(<AccessOrgsSection profileId="p1" />);
    const toggle = await screen.findByRole("switch", {
      name: /Anyone signed in can create an organization/,
    });
    expect(toggle).not.toBeChecked();
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(api.serverSetOpenOrgCreation).toHaveBeenCalledWith("p1", true),
    );
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("keeps the old value and says why when the server refuses", async () => {
    api.serverSetOpenOrgCreation.mockRejectedValue(new Error("403 forbidden"));
    const push = vi.fn();
    useStudioStore.setState({ pushNotification: push });
    render(<AccessOrgsSection profileId="p1" />);
    const toggle = await screen.findByRole("switch", {
      name: /Anyone signed in can create an organization/,
    });
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't change the setting",
          detail: "You don't have permission to do that.",
        }),
      ),
    );
    expect(toggle).not.toBeChecked();
  });
});
