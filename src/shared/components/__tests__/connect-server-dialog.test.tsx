import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResult } from "@/shared/api/server-admin";

const api = vi.hoisted(() => ({
  serversList: vi.fn(),
  serversOAuthProviders: vi.fn(),
  serversOAuthLogin: vi.fn(),
}));
vi.mock("@/shared/api/server-admin", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-admin")>()),
  ...api,
}));
// Desktop-only flows (this file): a saved-servers list and an OAuth round
// trip that never touches the network or Tauri IPC directly.
vi.mock("@/shared/api/web", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web")>()),
  WEB: false,
}));

import { ConnectServerForm } from "../connect-server-dialog";

const me = (over: Partial<MeResult> = {}): MeResult => ({
  user_id: "u1",
  email: "boss@x.com",
  name: "Boss",
  server_role: "member",
  can_manage_roles: false,
  orgs: [],
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.serversList.mockResolvedValue([]);
});
afterEach(cleanup);

/** Renders the form, enters a server URL, and waits for the Google sign in
 *  button so `signIn` has something to click (desktop only shows it once
 *  `serversOAuthProviders` has resolved). */
async function readyToSignIn(providers: string[] = ["google"]) {
  api.serversOAuthProviders.mockResolvedValue(providers);
  render(<ConnectServerForm on_connect={vi.fn()} show_server_fields />);
  await userEvent.type(
    screen.getByLabelText("Server URL"),
    "https://dh.example.com",
  );
  return screen.findByRole(
    "button",
    { name: "Continue with Google" },
    { timeout: 2000 },
  );
}

describe("ConnectServerForm sign in outcomes", () => {
  it("moves to the claim step when the server has no owner yet", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockResolvedValue({
      kind: "claim",
      ticket: "tix-1",
    });
    await userEvent.click(button);
    expect(
      await screen.findByText("This server has no owner yet"),
    ).toBeVisible();
  });

  it("shows the refusal message and stays on the sign in step so the person can retry", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockResolvedValue({
      kind: "refused",
      error: "not_invited",
      email: "a@x.com",
    });
    await userEvent.click(button);
    expect(
      await screen.findByText(/a@x\.com.*hasn't been invited/),
    ).toBeVisible();
    // Refused, not claim: the claim step must not appear.
    expect(
      screen.queryByText("This server has no owner yet"),
    ).not.toBeInTheDocument();
    // Still able to retry.
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
  });

  it("moves to the org picker when the sign in lands in an existing account", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockResolvedValue({
      kind: "signed_in",
      me: me({ orgs: [] }),
    });
    await userEvent.click(button);
    expect(await screen.findByText("Signed in as boss@x.com")).toBeVisible();
  });

  it("shows a plain error message when the OAuth round trip itself fails", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockRejectedValue(new Error("network unreachable"));
    await userEvent.click(button);
    expect(await screen.findByText(/network unreachable/)).toBeVisible();
  });
});
