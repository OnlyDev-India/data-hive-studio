import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgLink } from "@/shared/api/server-invites";

const api = vi.hoisted(() => ({
  serversOrgLinkCreate: vi.fn(),
  serversOrgLinkRevoke: vi.fn(),
}));
vi.mock("@/shared/api/client", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/client")>()),
  ...api,
}));
vi.mock("@/shared/api/web", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web")>()),
  WEB: false,
}));
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { useStudioStore } from "@/shared/store";
import { OrgLinksSection, linkState } from "../org-links-section";

const CODE = "0123456789abcdef01234567";
const DAY = 86_400_000;

const link = (over: Partial<OrgLink> = {}): OrgLink => ({
  code: CODE,
  org_id: "o1",
  role: "member",
  created_by: "u1",
  max_uses: 10,
  uses_count: 2,
  expires_ms: Date.now() + 5 * DAY,
  created_ms: 1,
  ...over,
});

function setup(links: OrgLink[] = []) {
  const onChanged = vi.fn();
  useStudioStore.setState({
    notifications: [],
    serverSessions: {
      p1: {
        profile: {
          id: "p1",
          name: "Acme",
          url: "https://db.acme.com/",
          org_id: "o1",
        },
        me: { orgs: [] },
        connIds: [],
      },
    } as never,
  });
  render(
    <OrgLinksSection
      links={links}
      profileId="p1"
      orgId="o1"
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

beforeEach(() => {
  api.serversOrgLinkCreate.mockReset().mockResolvedValue(link());
  api.serversOrgLinkRevoke.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);

describe("linkState", () => {
  const now = 1_000_000;
  it("is live with the days left, or says why it is dead", () => {
    expect(
      linkState({ max_uses: 5, uses_count: 1, expires_ms: now + 3 * DAY }, now),
    ).toEqual({ live: true, text: "Expires in 3 days" });
    expect(
      linkState({ max_uses: 5, uses_count: 1, expires_ms: now + 1000 }, now),
    ).toEqual({ live: true, text: "Expires within a day" });
    expect(
      linkState({ max_uses: 5, uses_count: 1, expires_ms: now - 1 }, now),
    ).toEqual({ live: false, text: "Expired" });
    expect(
      linkState({ max_uses: 5, uses_count: 5, expires_ms: now + DAY }, now),
    ).toEqual({ live: false, text: "Used up" });
  });
});

describe("OrgLinksSection", () => {
  it("creates a link with the default limit and expiry", async () => {
    const onChanged = setup();
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() =>
      expect(api.serversOrgLinkCreate).toHaveBeenCalledWith("p1", "o1", 10, 7),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("sends the chosen limit and expiry", async () => {
    setup();
    const uses = screen.getByLabelText("People who can use it");
    await userEvent.clear(uses);
    await userEvent.type(uses, "100");
    await userEvent.click(screen.getByLabelText("Expires"));
    await userEvent.click(
      await screen.findByRole("option", { name: "30 days" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() =>
      expect(api.serversOrgLinkCreate).toHaveBeenCalledWith(
        "p1",
        "o1",
        100,
        30,
      ),
    );
  });

  it("refuses a limit outside 1 to 100 before asking the server", async () => {
    setup();
    const uses = screen.getByLabelText("People who can use it");
    for (const bad of ["0", "101", "2.5", ""]) {
      await userEvent.clear(uses);
      if (bad) await userEvent.type(uses, bad);
      expect(
        screen.getByRole("button", { name: "Create link" }),
      ).toBeDisabled();
    }
    expect(screen.getByText(/whole number from 1 to 100/)).toBeVisible();
    expect(api.serversOrgLinkCreate).not.toHaveBeenCalled();
  });

  it("shows the join link and copies the link or the bare code", async () => {
    setup([link()]);
    expect(screen.getByText(`https://db.acme.com/?join=${CODE}`)).toBeVisible();
    expect(screen.getByText(/2\/10 used · Expires in 5 days/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      `https://db.acme.com/?join=${CODE}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(CODE);
  });

  it("offers nothing to copy on a link that no longer works", () => {
    setup([
      link({ uses_count: 10 }),
      link({ code: "b".repeat(24), expires_ms: 1 }),
    ]);
    expect(screen.getByText(/Used up/)).toBeVisible();
    expect(screen.getByText(/Expired/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Revoke link" })).toHaveLength(
      2,
    );
  });

  it("revokes only after a second click", async () => {
    const onChanged = setup([link()]);
    const revoke = screen.getByRole("button", { name: "Revoke link" });
    await userEvent.click(revoke);
    expect(api.serversOrgLinkRevoke).not.toHaveBeenCalled();
    await userEvent.click(revoke);
    await waitFor(() =>
      expect(api.serversOrgLinkRevoke).toHaveBeenCalledWith("p1", "o1", CODE),
    );
    expect(onChanged).toHaveBeenCalled();
  });
});
