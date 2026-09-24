import { useEffect, useState } from "react";
import {
  Building2,
  Cloud,
  KeyRound,
  Loader2,
  Plus,
  TicketCheck,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  WEB,
  apiUrl,
  webOAuthStartUrl,
  webAddServer,
  deriveServerId,
} from "@/shared/api/web";
import { makePkce, rememberVerifier } from "@/shared/api/web-session";
import {
  serversList,
  serversOAuthProviders,
  serversOAuthLogin,
  serversReuseSession,
  serversOrgCreateNew,
  serversSaveProfile,
  type MeResult,
  type Organization,
  type ServerProfileView,
} from "@/shared/api/server-admin";
import {
  serversInviteAcceptNew,
  serversInviteDeclineNew,
  serversMyInvitesNew,
  serversOrgRedeemLinkNew,
  type PendingInvite,
} from "@/shared/api/server-invites";
import { accessErrorMessage } from "@/shared/api/server-access";
import { parseJoinCode } from "@/shared/api/web-join";
import {
  claimErrorMessage,
  claimNeedsNewSignIn,
  refusalMessage,
  serversClaim,
} from "@/shared/api/server-claim";

export const PROVIDER_LABELS: Record<string, string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
};

/** Inline error banner — errors surface here rather than as a toast
 *  notification, since this form always renders inside a modal dialog and
 *  the notification stack renders behind it. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
      {message}
    </p>
  );
}

export interface ConnectResult {
  /** Already-saved, ready-to-connect profile id. */
  profileId: string;
}

interface ConnectServerFormProps {
  on_connect: (result: ConnectResult) => void;
  /** Show the Server URL field (desktop only — web is always same-origin). */
  show_server_fields?: boolean;
  /** External error message (e.g. from a parent's own connect attempt). */
  error?: string | null;
}

/**
 * OAuth sign-in + organization picker used by WebGate AND the "Add server"
 * dialog (`ServerMenu`). Steps:
 *   0. If any server is already signed in to (any saved profile — a
 *      session isn't org-scoped, so ANY of them proves the identity), offer
 *      an explicit choice: reuse one of those logins, or add a new server.
 *      Reusing skips straight to step 2 with no fresh OAuth round trip.
 *   1. Sign in with Google/GitHub — desktop opens the system browser and
 *      catches the callback on a local loopback listener
 *      (`servers_oauth_login`); web does a full-page redirect through
 *      `/auth/{provider}/start` (see `webOAuthStartUrl`) and never reaches
 *      step 2 in THIS component — WebGate itself catches the return trip
 *      (`?code=`, `?ticket=` or `?error=` on reload) and renders
 *      `OrgPickerStep` or `ClaimServerStep` directly. A server closed to
 *      strangers can refuse the sign in (shown here as a plain message), or
 *      have no owner yet, which adds a claim step (`ClaimServerStep`) where
 *      the setup code from the server log is entered.
 *   2. Pick (or create, or join via invite code) an organization, then
 *      persist the profile.
 */
export function ConnectServerForm({
  on_connect,
  show_server_fields = false,
  error: externalError,
}: ConnectServerFormProps) {
  const [step, setStep] = useState<"choose" | "new">("new");
  const [saved, setSaved] = useState<ServerProfileView[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  // The session itself is never held here: on desktop it stays in Rust, on the
  // web in `web-session.ts`. This is only who signed in, and to which server.
  const [session, setSession] = useState<{
    url: string;
    me: MeResult;
  } | null>(null);
  const [claim, setClaim] = useState<{ url: string; ticket: string } | null>(
    null,
  );
  const [providers, setProviders] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const display_error = formError ?? externalError ?? null;

  // Offer "use an existing sign-in" whenever more than one distinct SERVER
  // has already been added — desktop only. Web only ever has one possible
  // server (this same origin — there's no URL to choose between), so there
  // it doesn't make sense to show a "choose a server" list at all; see the
  // web-only effect below instead.
  useEffect(() => {
    if (WEB) return;
    let cancelled = false;
    void serversList()
      .then((list) => {
        if (cancelled) return;
        setSaved(list);
        if (list.length > 0) setStep("choose");
      })
      .catch(() => {
        // no saved servers reachable — just fall through to "add a new server"
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Web: this app already knows the (only) server's URL, so there's
  // nothing to "choose" — just check silently whether we already hold a
  // valid session for it (from a previously joined org here) and, if so,
  // skip straight to the org picker; otherwise fall through to plain
  // sign-in buttons for whichever providers this server supports.
  useEffect(() => {
    if (!WEB) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    setChecking(true);
    void serversReuseSession(apiUrl())
      .then((existing) => {
        if (cancelled) return;
        if (existing) {
          setSession({ url: apiUrl(), me: existing.me });
          return;
        }
        return serversOAuthProviders(apiUrl()).then(
          (p) => !cancelled && setProviders(p),
        );
      })
      .catch((e: unknown) => !cancelled && setCheckError(String(e)))
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (WEB || step !== "new") return;
    const trimmed = url.trim();
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset derived state when the url is cleared
      setProviders(null);
      setCheckError(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    setCheckError(null);
    const id = setTimeout(() => {
      void serversOAuthProviders(trimmed)
        .then((p) => !cancelled && setProviders(p))
        .catch((e: unknown) => !cancelled && setCheckError(String(e)))
        .finally(() => !cancelled && setChecking(false));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [url, step]);

  async function connectExisting(base: string) {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const existing = await serversReuseSession(base);
      if (!existing) {
        throw new Error(
          "That sign-in has expired — add this server again to renew it.",
        );
      }
      setSession({ url: base, me: existing.me });
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function persist(org: Organization, sess: { url: string }) {
    setBusy(true);
    setFormError(null);
    try {
      let profileId: string;
      if (WEB) {
        const id = deriveServerId(sess.url, org.id);
        webAddServer({
          id,
          url: sess.url,
          name: org.name,
          org_id: org.id,
        });
        profileId = id;
      } else {
        const saved = await serversSaveProfile(org.name, sess.url, org.id);
        profileId = saved.id;
      }
      on_connect({ profileId });
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signIn(provider: "google" | "github") {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      if (WEB) {
        // The verifier is a secret only this tab knows; the server gets its
        // hash now and the verifier itself only when the login code that
        // comes back in the address is traded (see WebGate).
        const { verifier, challenge } = await makePkce();
        rememberVerifier(verifier);
        window.location.assign(
          webOAuthStartUrl(
            provider,
            window.location.origin + window.location.pathname,
            challenge,
          ),
        );
        return; // page navigates away — nothing left to do here
      }
      const base = url.trim();
      if (!base) throw new Error("Enter a server URL first");
      const result = await serversOAuthLogin(base, provider);
      if (result.kind === "signed_in") {
        setSession({ url: base, me: result.me });
      } else if (result.kind === "claim") {
        setClaim({ url: base, ticket: result.ticket });
      } else {
        setFormError(refusalMessage(result.error, result.email));
      }
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (claim) {
    return (
      <ClaimServerStep
        url={claim.url}
        ticket={claim.ticket}
        onClaimed={(r) => {
          setClaim(null);
          setSession({ url: claim.url, me: r.me });
        }}
        onCancel={() => setClaim(null)}
      />
    );
  }

  if (session) {
    return (
      <OrgPickerStep
        me={session.me}
        url={session.url}
        busy={busy}
        error={display_error}
        onSelect={(org) => void persist(org, session)}
      />
    );
  }

  if (step === "choose") {
    const distinct_urls = [...new Map(saved.map((p) => [p.url, p])).values()];
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Choose a server you're already signed in to, or add a new one.
        </p>
        <FormError message={display_error} />
        <div className="flex flex-col gap-2">
          {distinct_urls.map((p) => (
            <Button
              key={p.url}
              variant="outline"
              className="justify-start"
              disabled={busy}
              onClick={() => void connectExisting(p.url)}
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 shrink-0 animate-spin" />
              ) : (
                <Cloud className="mr-2 size-4 shrink-0" />
              )}
              <span className="flex-1 truncate text-left">{p.url}</span>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => setStep("new")}
          >
            <Plus className="mr-1 size-3.5" /> Add a new server
          </Button>
        </div>
      </div>
    );
  }

  const need_url = show_server_fields && !WEB && !url.trim();

  return (
    <div className="flex flex-col gap-4">
      {show_server_fields && !WEB && (
        <div className="grid gap-1.5">
          <Label htmlFor="cs-url">Server URL</Label>
          <Input
            id="cs-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://db.acme.com:8080"
          />
        </div>
      )}
      <FormError message={display_error} />
      <div className="grid gap-2 pt-1">
        {need_url ? (
          <p className="text-muted-foreground text-xs">
            Enter a server URL to see its available sign-in options.
          </p>
        ) : checking ? (
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> Checking sign-in
            options…
          </div>
        ) : checkError ? (
          <p className="text-destructive text-xs">
            Couldn't reach that server: {checkError}
          </p>
        ) : providers && providers.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            This server has no OAuth provider configured.
          </p>
        ) : (
          (providers ?? []).map((provider, i) => (
            <Button
              key={provider}
              variant={i === 0 ? "default" : "outline"}
              disabled={busy}
              onClick={() => void signIn(provider as "google" | "github")}
            >
              {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
              {PROVIDER_LABELS[provider] ?? `Continue with ${provider}`}
            </Button>
          ))
        )}
      </div>
      {saved.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => setStep("choose")}
        >
          Back
        </Button>
      )}
    </div>
  );
}

/**
 * Claim step for a server that has no owner yet. The person just signed in
 * (that is the ticket); entering the setup code the server printed in its log
 * makes them the owner. Exported so WebGate can render it directly for the web
 * OAuth-callback landing.
 */
export function ClaimServerStep({
  url,
  ticket,
  onClaimed,
  onCancel,
}: {
  url: string;
  ticket: string;
  onClaimed: (result: { me: MeResult }) => void;
  /** Back out to the sign in buttons (also the only way forward when the
   *  ticket has expired or someone else claimed first). */
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);

  async function submit() {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onClaimed(await serversClaim(url, ticket, code.trim()));
    } catch (e) {
      setError(claimErrorMessage(e));
      setStuck(claimNeedsNewSignIn(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-start gap-2.5">
        <KeyRound className="text-primary mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-sm font-medium">This server has no owner yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Enter the setup code printed in the server log to become its owner.
            After that, only people you invite can sign in.
          </p>
        </div>
      </div>
      <FormError message={error} />
      <div className="grid gap-1.5">
        <Label htmlFor="claim-code">Setup code</Label>
        <Input
          id="claim-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ABCD-EFGH-JKLM-NPQR-STUV"
          className="font-mono"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          disabled={stuck}
        />
      </div>
      <div className="flex gap-2">
        {stuck ? (
          <Button type="button" onClick={onCancel}>
            Sign in again
          </Button>
        ) : (
          <>
            <Button type="submit" disabled={busy || !code.trim()}>
              {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
              Claim server
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Back
            </Button>
          </>
        )}
      </div>
    </form>
  );
}

/**
 * Post-sign-in step: pick an existing org, create a new one, or redeem an
 * invite code. Exported so WebGate can render it directly for the web
 * OAuth-callback landing (a full-page redirect, so it can't just keep this
 * form's local `session` state around).
 */
export function OrgPickerStep({
  me,
  url,
  busy,
  error: externalError,
  onSelect,
}: {
  me: MeResult;
  url: string;
  busy: boolean;
  /** Error from a caller-owned step after `onSelect` (e.g. persisting the
   *  profile) — shown alongside this component's own errors. */
  error?: string | null;
  onSelect: (org: Organization) => void;
}) {
  const can_create = me.can_create_org;
  // Land on the form that can succeed: an org to open, else create when the
  // server allows it, else the list (with the way to join one).
  const home_mode = me.orgs.length || !can_create ? "pick" : "create";
  const [mode, setMode] = useState<"pick" | "create" | "redeem">(home_mode);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const disabled = busy || localBusy;

  // Invitations for this email wait here until the person accepts or
  // declines, so an org never appears in their list without their say. A
  // failure to load them is not fatal: the rest of the picker still works.
  useEffect(() => {
    let cancelled = false;
    void serversMyInvitesNew(url)
      .then((list) => {
        if (cancelled) return;
        setPending(list);
        // Someone with no org and an invitation should see it, not a form.
        if (list.length > 0 && me.orgs.length === 0) setMode("pick");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, me.orgs.length]);
  const display_error = localError ?? externalError ?? null;

  async function createOrg() {
    if (!name.trim()) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      onSelect(await serversOrgCreateNew(url, name.trim()));
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setLocalBusy(false);
    }
  }

  async function accept(inv: PendingInvite) {
    setLocalBusy(true);
    setLocalError(null);
    try {
      onSelect(await serversInviteAcceptNew(url, inv.id));
    } catch (e) {
      setLocalError(accessErrorMessage(e));
    } finally {
      setLocalBusy(false);
    }
  }

  async function decline(inv: PendingInvite) {
    setLocalBusy(true);
    setLocalError(null);
    try {
      await serversInviteDeclineNew(url, inv.id);
      setPending((list) => list.filter((p) => p.id !== inv.id));
    } catch (e) {
      setLocalError(accessErrorMessage(e));
    } finally {
      setLocalBusy(false);
    }
  }

  async function redeem() {
    if (!code.trim()) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      onSelect(await serversOrgRedeemLinkNew(url, parseJoinCode(code)));
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">Signed in as {me.email}</p>
      <FormError message={display_error} />

      {mode === "pick" && (
        <div className="flex flex-col gap-2">
          {pending.length > 0 && (
            <div className="flex flex-col gap-2 pb-1">
              <p className="text-sm font-medium">Invitations</p>
              {pending.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <Building2 className="text-muted-foreground size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{inv.org_name}</div>
                    <div className="text-muted-foreground text-2xs truncate">
                      {inv.role} · from {inv.inviter_name || inv.inviter_email}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={disabled}
                    aria-label={`Accept invitation to ${inv.org_name}`}
                    onClick={() => void accept(inv)}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`Decline invitation to ${inv.org_name}`}
                    onClick={() => void decline(inv)}
                  >
                    Decline
                  </Button>
                </div>
              ))}
            </div>
          )}
          {me.orgs.map((o) => (
            <Button
              key={o.id}
              variant="outline"
              className="justify-start"
              disabled={disabled}
              onClick={() => onSelect(o)}
            >
              <Building2 className="mr-2 size-4" />
              <span className="flex-1 truncate text-left">{o.name}</span>
              <span className="text-muted-foreground text-xs">{o.role}</span>
            </Button>
          ))}
          {me.orgs.length === 0 && pending.length === 0 && (
            <p className="text-muted-foreground text-sm">
              You aren&apos;t in an organization yet. Ask an owner or admin to
              invite you by email, or use an invite code.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            {can_create && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMode("create")}
              >
                New organization
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setMode("redeem")}>
              <TicketCheck className="mr-1 size-3.5" /> Have an invite code?
            </Button>
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className="grid gap-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc"
            autoFocus
          />
          <Button
            disabled={disabled || !name.trim()}
            onClick={() => void createOrg()}
          >
            {localBusy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Create organization
          </Button>
          <div className="flex gap-2">
            {home_mode === "pick" && (
              <Button size="sm" variant="ghost" onClick={() => setMode("pick")}>
                Back
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setMode("redeem")}>
              <TicketCheck className="mr-1 size-3.5" /> Have an invite code?
            </Button>
          </div>
        </div>
      )}

      {mode === "redeem" && (
        <div className="grid gap-2">
          <Label htmlFor="org-code">Invite link or code</Label>
          <Input
            id="org-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste the invite link or code"
            autoFocus
          />
          <Button
            disabled={disabled || !code.trim()}
            onClick={() => void redeem()}
          >
            {localBusy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Join organization
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode(home_mode)}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
