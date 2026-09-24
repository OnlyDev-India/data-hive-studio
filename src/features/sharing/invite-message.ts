import { WEB } from "@/shared/api/web";
import type { OrgRole } from "@/shared/api/server-admin";

// The server sends no email (spec 0011): the inviter copies this message or
// opens it in their own mail app. It carries no secret, so it can travel
// through any channel.

export interface InviteMessageInput {
  inviterName: string;
  orgName: string;
  role: OrgRole;
  /** The server address, `https://db.acme.com`. */
  serverAddress: string;
  /** The invited email, so the person signs in with the right account. */
  email: string;
}

export interface InviteMessage {
  subject: string;
  body: string;
  /** `mailto:` address with the subject and body filled in. */
  mailto: string;
}

export function buildInviteMessage(input: InviteMessageInput): InviteMessage {
  const { inviterName, orgName, role, serverAddress, email } = input;
  const subject = `${inviterName} invited you to ${orgName} on DH Studio`;
  const body = [
    `${inviterName} invited you to join ${orgName} as ${role === "admin" ? "an" : "a"} ${role}.`,
    "",
    `To join: open ${serverAddress} in a browser, or add it as a team server in DH Studio. Sign in with the Google or GitHub account that uses ${email}, then accept the invitation.`,
  ].join("\n");
  // Keep the `@` readable in the address; everything else is encoded.
  const to = encodeURIComponent(email).replace("%40", "@");
  const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { subject, body, mailto };
}

/** Open a `mailto:` link in the person's own mail app. */
export async function openMailto(mailto: string): Promise<void> {
  if (WEB) {
    window.location.assign(mailto);
    return;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(mailto);
}
