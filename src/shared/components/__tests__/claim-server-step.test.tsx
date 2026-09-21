import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api = vi.hoisted(() => ({ serversClaim: vi.fn() }));
vi.mock("@/shared/api/server-claim", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-claim")>()),
  serversClaim: api.serversClaim,
}));

import { ClaimServerStep } from "../connect-server-dialog";

const ME = { user_id: "u1", email: "boss@x.com" };

function setup() {
  const onClaimed = vi.fn();
  const onCancel = vi.fn();
  render(
    <ClaimServerStep
      url="https://dh.example.com"
      ticket="ticket-1"
      onClaimed={onClaimed}
      onCancel={onCancel}
    />,
  );
  return { onClaimed, onCancel };
}

beforeEach(() => api.serversClaim.mockReset());
afterEach(cleanup);

describe("ClaimServerStep", () => {
  it("says the server has no owner and asks for the setup code", () => {
    setup();
    expect(screen.getByText("This server has no owner yet")).toBeVisible();
    expect(screen.getByLabelText("Setup code")).toBeVisible();
    // Nothing to send until a code is typed.
    expect(screen.getByRole("button", { name: "Claim server" })).toBeDisabled();
  });

  it("sends the ticket with the typed code and hands back the owner's session", async () => {
    api.serversClaim.mockResolvedValue({ me: ME });
    const { onClaimed } = setup();
    await userEvent.type(
      screen.getByLabelText("Setup code"),
      "abcd-efgh-jklm-npqr-stuv",
    );
    await userEvent.click(screen.getByRole("button", { name: "Claim server" }));
    await waitFor(() => expect(onClaimed).toHaveBeenCalled());
    expect(api.serversClaim).toHaveBeenCalledWith(
      "https://dh.example.com",
      "ticket-1",
      "abcd-efgh-jklm-npqr-stuv",
    );
    expect(onClaimed).toHaveBeenCalledWith({ me: ME });
  });

  it("keeps the form for a wrong code so it can be retyped", async () => {
    api.serversClaim.mockRejectedValueOnce(new Error("code_invalid"));
    const { onClaimed } = setup();
    await userEvent.type(screen.getByLabelText("Setup code"), "WRONG");
    await userEvent.click(screen.getByRole("button", { name: "Claim server" }));
    expect(await screen.findByText(/setup code isn't right/)).toBeVisible();
    expect(onClaimed).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Claim server" })).toBeEnabled();
  });

  it.each([
    ["ticket_invalid", /sign in has expired/],
    ["already_claimed", /already claimed/],
  ])("asks to sign in again after %s", async (code, message) => {
    api.serversClaim.mockRejectedValueOnce(new Error(code));
    const { onCancel } = setup();
    await userEvent.type(screen.getByLabelText("Setup code"), "ABCD");
    await userEvent.click(screen.getByRole("button", { name: "Claim server" }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Claim server" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Sign in again" }),
    );
    expect(onCancel).toHaveBeenCalled();
  });
});
