import { useEffect, useState } from "react";
import { Building2, Cloud, Loader2, Plus, TicketCheck } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { WEB, apiUrl, webOAuthStartUrl, webAddServer, deriveServerId } from "@/shared/api/web";
import {
  serversList,
  serversOAuthProviders,
  serversOAuthLogin,
  serversReuseSession,
  serversOrgCreateNew,
  serversOrgRedeemInviteNew,
  serversSaveProfile,
  type MeResult,
  type Organization,
  type ServerProfileView,
} from "@/shared/api/server-admin";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
};

/** Inline error banner — errors surface here rather than as a toast
 *  notification, since this form always renders inside a modal dialog and
 *  the notification stack renders behind it. */
function FormError({ message }: { message: string | null | undefined }) {
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
 *      (`?token=` on reload) and renders `OrgPickerStep` directly.
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
  const [session, setSession] = useState<{
    url: string;
    token: string;
    me: MeResult;
  } | null>(null);
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
          setSession({ url: apiUrl(), token: existing.token, me: existing.me });
          return;
        }
        return serversOAuthProviders(apiUrl()).then((p) => !cancelled && setProviders(p));
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
      setSession({ url: base, token: existing.token, me: existing.me });
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function persist(org: Organization, sess: { url: string; token: string }) {
    setBusy(true);
    setFormError(null);
    try {
      let profileId: string;
      if (WEB) {
        const id = deriveServerId(sess.url, org.id);
        webAddServer({ id, url: sess.url, token: sess.token, name: org.name, org_id: org.id });
        profileId = id;
      } else {
        const saved = await serversSaveProfile(org.name, sess.url, sess.token, org.id);
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
        const base = apiUrl();
        window.location.assign(
          webOAuthStartUrl(base, provider, window.location.href.split("?")[0]),
        );
        return; // page navigates away — nothing left to do here
      }
      const base = url.trim();
      if (!base) throw new Error("Enter a server URL first");
      const result = await serversOAuthLogin(base, provider);
      setSession({ url: base, token: result.token, me: result.me });
    } catch (e) {
      setFormError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <OrgPickerStep
        me={session.me}
        url={session.url}
        token={session.token}
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
            <Loader2 className="size-3.5 animate-spin" /> Checking sign-in options…
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
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setStep("choose")}>
          Back
        </Button>
      )}
    </div>
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
  token,
  busy,
  error: externalError,
  onSelect,
}: {
  me: MeResult;
  url: string;
  token: string;
  busy: boolean;
  /** Error from a caller-owned step after `onSelect` (e.g. persisting the
   *  profile) — shown alongside this component's own errors. */
  error?: string | null;
  onSelect: (org: Organization) => void;
}) {
  const [mode, setMode] = useState<"pick" | "create" | "redeem">(
    me.orgs.length ? "pick" : "create",
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const disabled = busy || localBusy;
  const display_error = localError ?? externalError ?? null;

  async function createOrg() {
    if (!name.trim()) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      onSelect(await serversOrgCreateNew(url, token, name.trim()));
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setLocalBusy(false);
    }
  }

  async function redeem() {
    if (!code.trim()) return;
    setLocalBusy(true);
    setLocalError(null);
    try {
      onSelect(await serversOrgRedeemInviteNew(url, token, code.trim()));
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
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setMode("create")}>
              New organization
            </Button>
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
          <Button disabled={disabled || !name.trim()} onClick={() => void createOrg()}>
            {localBusy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Create organization
          </Button>
          <div className="flex gap-2">
            {me.orgs.length > 0 && (
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
          <Label htmlFor="org-code">Invite code</Label>
          <Input
            id="org-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Paste invite code"
            autoFocus
          />
          <Button disabled={disabled || !code.trim()} onClick={() => void redeem()}>
            {localBusy && <Loader2 className="mr-1 size-4 animate-spin" />}
            Join organization
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMode(me.orgs.length ? "pick" : "create")}
          >
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
