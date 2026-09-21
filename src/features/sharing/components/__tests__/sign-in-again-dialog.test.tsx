import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServerProfileView } from "@/shared/api/server-admin";

const api = vi.hoisted(() => ({
  serversOAuthProviders: vi.fn(),
  serversOAuthLogin: vi.fn(),
}));
vi.mock("@/shared/api/server-admin", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-admin")>()),
  ...api,
}));

import { SignInAgainDialog } from "../sign-in-again-dialog";

const PROFILE: ServerProfileView = {
  id: "p1",
  name: "Acme",
  url: "https://db.acme.com",
  org_id: "o1",
  connected: false,
  signed_in: false,
};

function setup() {
  const onSignedIn = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <SignInAgainDialog
      profile={PROFILE}
      onOpenChange={onOpenChange}
      onSignedIn={onSignedIn}
    />,
  );
  return { onSignedIn, onOpenChange };
}

beforeEach(() => {
  api.serversOAuthProviders.mockReset().mockResolvedValue(["google", "github"]);
  api.serversOAuthLogin.mockReset();
});
afterEach(cleanup);

describe("SignInAgainDialog", () => {
  it("offers the server's sign in options and promises the work stays", async () => {
    setup();
    expect(
      await screen.findByRole("button", { name: "Continue with Google" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Continue with GitHub" }),
    ).toBeVisible();
    expect(screen.getByText(/tabs and unsaved work stay/)).toBeVisible();
    expect(api.serversOAuthProviders).toHaveBeenCalledWith(
      "https://db.acme.com",
    );
  });

  it("signs in to the profile's own server, then reconnects that profile", async () => {
    api.serversOAuthLogin.mockResolvedValue({
      kind: "signed_in",
      me: { user_id: "u1" },
    });
    const { onSignedIn, onOpenChange } = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(PROFILE));
    expect(api.serversOAuthLogin).toHaveBeenCalledWith(
      "https://db.acme.com",
      "google",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("explains a refusal and stays open", async () => {
    api.serversOAuthLogin.mockResolvedValue({
      kind: "refused",
      error: "not_invited",
      email: "a@x.com",
    });
    const { onSignedIn } = setup();
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue with Google" }),
    );
    expect(await screen.findByText(/hasn't been invited/)).toBeVisible();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("says when the server cannot be reached", async () => {
    api.serversOAuthProviders.mockRejectedValue(
      new Error("connection refused"),
    );
    setup();
    expect(await screen.findByText(/Couldn't reach that server/)).toBeVisible();
  });
});
