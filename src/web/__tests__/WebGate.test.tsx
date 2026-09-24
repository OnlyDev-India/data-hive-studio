import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WebGate } from "../WebGate";
import { clearWebKey, setWebKey, webKey } from "@/shared/api/web";

const info = (key_required: boolean) =>
  new Response(JSON.stringify({ key_required, read_only: false }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  clearWebKey();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = () =>
  render(
    <WebGate>
      <p>the studio</p>
    </WebGate>,
  );

describe("WebGate (AC-4, AC-5)", () => {
  it("opens straight to the studio when the server has no key: no sign in", async () => {
    fetchMock.mockResolvedValueOnce(info(false));
    page();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("the studio")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/info");
  });

  it("asks for the key when the server needs one and none is saved", async () => {
    fetchMock.mockResolvedValueOnce(info(true));
    page();
    expect(await screen.findByLabelText("Key")).toBeTruthy();
  });

  it("keeps the prompt open with an error on a wrong key", async () => {
    fetchMock
      .mockResolvedValueOnce(info(true))
      .mockResolvedValueOnce(
        new Response("access key required", { status: 401 }),
      );
    page();
    await userEvent.type(await screen.findByLabelText("Key"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("That key was not accepted.")).toBeTruthy();
    expect(webKey()).toBeNull();
  });

  it("saves the right key for this tab and lets the page through", async () => {
    fetchMock
      .mockResolvedValueOnce(info(true))
      .mockResolvedValueOnce(new Response("no such handle", { status: 404 }));
    page();
    await userEvent.type(await screen.findByLabelText("Key"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Key")).toBeNull(),
    );
    expect(sessionStorage.getItem("dh.web.key")).toBe("s3cret");
  });

  it("does not ask again when a saved key still works", async () => {
    setWebKey("s3cret");
    fetchMock
      .mockResolvedValueOnce(info(true))
      .mockResolvedValueOnce(new Response("no such handle", { status: 404 }));
    page();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByLabelText("Key")).toBeNull();
  });

  it("says so when the server cannot be reached, and offers to try again", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    page();
    expect(await screen.findByText(/network down/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
