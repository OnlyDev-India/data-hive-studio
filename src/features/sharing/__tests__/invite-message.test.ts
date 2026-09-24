import { describe, expect, it } from "vitest";
import { buildInviteMessage } from "../invite-message";

const input = {
  inviterName: "Dana Reyes",
  orgName: "Acme Inc",
  role: "member" as const,
  serverAddress: "https://db.acme.com",
  email: "bob@x.com",
};

describe("buildInviteMessage", () => {
  it("names who invited, the org, the role, the address and the email", () => {
    const m = buildInviteMessage(input);
    expect(m.subject).toBe("Dana Reyes invited you to Acme Inc on DH Studio");
    expect(m.body).toContain(
      "Dana Reyes invited you to join Acme Inc as a member.",
    );
    expect(m.body).toContain("https://db.acme.com");
    expect(m.body).toContain("bob@x.com");
    expect(m.body).toMatch(/Google or GitHub/);
    expect(m.body).toMatch(/accept the invitation/);
  });

  it("says an admin, not a admin", () => {
    expect(buildInviteMessage({ ...input, role: "admin" }).body).toContain(
      "as an admin.",
    );
  });

  it("builds a mailto link that round trips the subject and body", () => {
    const m = buildInviteMessage({ ...input, email: "a+b@x.com" });
    expect(m.mailto.startsWith("mailto:a%2Bb@x.com?")).toBe(true);
    const url = new URL(m.mailto);
    expect(url.searchParams.get("subject")).toBe(m.subject);
    expect(url.searchParams.get("body")).toBe(m.body);
  });

  it("carries no secret: nothing but the message inputs", () => {
    const m = buildInviteMessage(input);
    expect(m.body).not.toMatch(/code|token|password/i);
  });
});
