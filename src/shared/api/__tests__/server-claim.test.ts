import { describe, it, expect } from "vitest";
import {
  claimErrorMessage,
  claimNeedsNewSignIn,
  parseSignInReturn,
  refusalMessage,
  stripSignInParams,
} from "../server-claim";

describe("parseSignInReturn", () => {
  it("reads each of the three outcomes", () => {
    expect(parseSignInReturn("?token=dhs_abc")).toEqual({
      kind: "token",
      token: "dhs_abc",
    });
    expect(parseSignInReturn("?ticket=00ff")).toEqual({
      kind: "ticket",
      ticket: "00ff",
    });
    expect(parseSignInReturn("?error=not_invited&email=a%2Bb%40x.com")).toEqual(
      { kind: "refused", error: "not_invited", email: "a+b@x.com" },
    );
  });

  it("keeps a refusal with no email at all", () => {
    expect(parseSignInReturn("?error=email_unverified&email=")).toEqual({
      kind: "refused",
      error: "email_unverified",
      email: "",
    });
  });

  it("is null for an ordinary page load", () => {
    expect(parseSignInReturn("")).toBeNull();
    expect(parseSignInReturn("?tab=2")).toBeNull();
  });
});

describe("stripSignInParams", () => {
  it("removes only the sign in parameters", () => {
    expect(stripSignInParams("?tab=2&token=t&error=x&email=e&ticket=k")).toBe(
      "tab=2",
    );
    expect(stripSignInParams("?ticket=k")).toBe("");
  });
});

describe("refusalMessage", () => {
  it("names the person's own email and the reason for each refusal", () => {
    expect(refusalMessage("not_invited", "a@x.com")).toMatch(
      /a@x\.com.*hasn't been invited/,
    );
    expect(refusalMessage("invite_expired", "a@x.com")).toMatch(
      /invite for .*a@x\.com.* has expired/,
    );
    expect(refusalMessage("email_unverified", "a@x.com")).toMatch(
      /a@x\.com.*no verified email/,
    );
    expect(refusalMessage("account_link_conflict", "a@x.com")).toMatch(
      /a@x\.com.*different account from the same provider/,
    );
  });

  it("still reads well with no email", () => {
    expect(refusalMessage("not_invited", "")).toMatch(/^That email hasn't/);
    expect(refusalMessage("email_unverified", "")).toMatch(
      /^Your account has no verified email/,
    );
  });

  it("falls back to the code for one it does not know", () => {
    expect(refusalMessage("something_new", "a@x.com")).toContain(
      "something_new",
    );
  });
});

describe("claim errors", () => {
  it("explains each claim refusal", () => {
    expect(claimErrorMessage(new Error("code_invalid"))).toMatch(
      /setup code isn't right/,
    );
    expect(claimErrorMessage("ticket_invalid")).toMatch(/expired/);
    expect(claimErrorMessage("already_claimed")).toMatch(/already claimed/);
    expect(claimErrorMessage(new Error("boom"))).toContain("boom");
  });

  it("only asks for a new sign in when retyping the code cannot help", () => {
    expect(claimNeedsNewSignIn("ticket_invalid")).toBe(true);
    expect(claimNeedsNewSignIn(new Error("already_claimed"))).toBe(true);
    expect(claimNeedsNewSignIn("code_invalid")).toBe(false);
  });
});
