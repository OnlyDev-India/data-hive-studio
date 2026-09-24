import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";
import {
  WEB,
  apiUrl,
  deriveServerId,
  wcall,
  webAddServer,
  webListServers,
  type WebServerConfig,
} from "@/shared/api/web";
import {
  SIGNED_OUT_EVENT,
  isSignedOut,
  webExchange,
} from "@/shared/api/web-session";
import { useStudioStore } from "@/shared/store";
import {
  friendlyConnectError,
  type MeResult,
  type Organization,
} from "@/shared/api/server-admin";
import {
  OLD_SERVER_MESSAGE,
  parseSignInReturn,
  refusalMessage,
  stripSignInParams,
  type SignInReturn,
} from "@/shared/api/server-claim";
import { serversOrgRedeemLinkNew } from "@/shared/api/server-invites";
import {
  forgetJoinCode,
  joinCodeFromSearch,
  pendingJoinCode,
  rememberJoinCode,
  stripJoinParam,
} from "@/shared/api/web-join";
import {
  ClaimServerStep,
  ConnectServerForm,
  OrgPickerStep,
  type ConnectResult,
} from "@/shared/components/connect-server-dialog";
import { Button } from "@/shared/components/ui/button";

interface GateProps {
  children: React.ReactNode;
}

type GateState = "connecting" | "login" | "claim" | "org-pick" | "ready";

const LAST_KEY = "dh.web.last";
const CONNECT_TIMEOUT_MS = 10_000;

/** Recover how an OAuth callback ended from the current URL: `?code=` (signed
 *  in: a one time login code, traded for a session below), `?ticket=` (this
 *  server needs its owner to claim it) or `?error=&email=` (refused). Appended
 *  by `router/auth.rs::auth_callback` after a `/auth/{provider}/start` round
 *  trip — see `webOAuthStartUrl`. A `?token=` means a server from before
 *  device sessions: nothing from it is used or kept. This only reads the
 *  address: `App` mounts the gate inside a `Suspense` whose child is still
 *  loading, so React throws the first render's state away and runs this again.
 *  Erasing the parameters here would leave that second run with nothing. */
function readSignInReturn(): SignInReturn | null {
  if (!WEB || typeof window === "undefined") return null;
  return parseSignInReturn(window.location.search);
}

/** Remove the sign in parameters from the address bar so a refresh doesn't
 *  try to use them again. Runs once the gate has really mounted. */
function clearSignInParams(): void {
  const rest = stripSignInParams(window.location.search);
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (rest ? `?${rest}` : ""),
  );
}

/** The shareable link's code (`?join=`), kept in `sessionStorage` so it
 *  survives the sign in round trip (a full page redirect). Only reads and
 *  remembers: the address bar is cleaned once the gate has mounted, like the
 *  sign in parameters, because the first render can be thrown away. */
function readJoinCode(): string | null {
  if (!WEB || typeof window === "undefined") return null;
  const from_url = joinCodeFromSearch(window.location.search);
  if (from_url) {
    rememberJoinCode(from_url);
    return from_url;
  }
  return pendingJoinCode();
}

/** Take `join` out of the address bar so the code is not left in history or
 *  a copied address. */
function clearJoinParam(): void {
  if (!new URLSearchParams(window.location.search).has("join")) return;
  const rest = stripJoinParam(window.location.search);
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (rest ? `?${rest}` : ""),
  );
}

const JOIN_FAILED =
  "That invite link didn't work. It may have expired, run out of uses or been revoked. Ask for a new one.";

export function WebGate({ children }: GateProps) {
  const [stored] = useState<WebServerConfig[]>(() =>
    WEB ? webListServers() : [],
  );
  const [last_id] = useState<string | null>(() =>
    WEB ? localStorage.getItem(LAST_KEY) : null,
  );
  const [sign_in_return] = useState<SignInReturn | null>(() =>
    readSignInReturn(),
  );
  const [join_code] = useState<string | null>(() => readJoinCode());
  const pending_code =
    sign_in_return?.kind === "code" ? sign_in_return.code : null;
  const claim_ticket =
    sign_in_return?.kind === "ticket" ? sign_in_return.ticket : null;
  const [state, setState] = useState<GateState>(() => {
    if (!WEB) return "ready";
    if (pending_code) return "org-pick";
    if (claim_ticket) return "claim";
    // Refused: show why on the sign in form, not a silent reconnect.
    if (sign_in_return) return "login";
    return stored.length === 0 ? "login" : "connecting";
  });
  const [gate_error, setGateError] = useState<string | null>(() => {
    if (sign_in_return?.kind === "refused")
      return refusalMessage(sign_in_return.error, sign_in_return.email);
    if (sign_in_return?.kind === "old_server") return OLD_SERVER_MESSAGE;
    return null;
  });
  const [oauth_session, setOAuthSession] = useState<{
    url: string;
    me: MeResult;
  } | null>(null);
  const exchanging = useRef(false);
  const [org_busy, setOrgBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sign_in_return) clearSignInParams();
  }, [sign_in_return]);

  useEffect(() => {
    if (WEB) clearJoinParam();
  }, []);

  /** Add a profile for `org` on `url` and connect it, then open the studio. */
  const open_org = useCallback(async (url: string, org: Organization) => {
    const id = deriveServerId(url, org.id);
    webAddServer({ id, url, name: org.name, org_id: org.id });
    await useStudioStore.getState().connectServer(id);
    localStorage.setItem(LAST_KEY, id);
    setState("ready");
  }, []);

  /** Use the shareable link the page was opened with, now that the person is
   *  signed in. The code is spent or dropped either way: it is tried once. */
  const redeem_join = useCallback(
    async (url: string): Promise<Organization | null> => {
      const code = pendingJoinCode();
      if (!code) return null;
      forgetJoinCode();
      try {
        return await serversOrgRedeemLinkNew(url, code);
      } catch {
        setGateError(JOIN_FAILED);
        return null;
      }
    },
    [],
  );

  // Trade the login code (if any) for a session, then resolve it into an
  // identity + org list. Runs once even when React runs effects twice: the code
  // and the verifier can each be used only once.
  useEffect(() => {
    if (!WEB || !pending_code || exchanging.current) return;
    exchanging.current = true;
    void (async () => {
      const url = apiUrl();
      try {
        await webExchange(pending_code);
        const me = await wcall<MeResult>("GET", "/v1/me", undefined, true);
        // An invite link wins over the last org: it is why they came.
        const joined = await redeem_join(url);
        if (joined) {
          await open_org(url, joined);
          return;
        }
        const target = stored.find((s) => s.id === last_id) ?? stored[0];
        if (target && me.orgs.some((o) => o.id === target.org_id)) {
          // Signing in again keeps the profile and its org: no org picker.
          await useStudioStore.getState().connectServer(target.id);
          localStorage.setItem(LAST_KEY, target.id);
          setState("ready");
          return;
        }
        setOAuthSession({ url, me });
      } catch (e) {
        setGateError(`Sign-in failed: ${String(e)}`);
        setState("login");
      }
    })();
  }, [pending_code, stored, last_id, redeem_join, open_org]);

  // A session that was working has ended (signed out here, in another tab, or
  // on another device): show the sign in dialog again.
  useEffect(() => {
    if (!WEB) return;
    const onSignedOut = () => {
      setOAuthSession(null);
      setGateError("You've been signed out. Sign in to continue.");
      setState("login");
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  // Track the last active profile so localStorage stays current.
  useEffect(() => {
    if (!WEB) return;
    return useStudioStore.subscribe((s) => {
      const ids = Object.keys(s.serverSessions);
      if (!ids.length) return;
      const latest = ids[ids.length - 1];
      if (localStorage.getItem(LAST_KEY) !== latest) {
        localStorage.setItem(LAST_KEY, latest);
      }
    });
  }, []);

  // ALWAYS try the last connected server first, with a timeout escape.
  useEffect(() => {
    if (!WEB || state !== "connecting") return;
    let cancelled = false;

    timer.current = setTimeout(() => {
      if (!cancelled) {
        setGateError("Connection timed out — the server may be unreachable.");
        setState("login");
      }
    }, CONNECT_TIMEOUT_MS);

    void (async () => {
      const target = stored.find((s) => s.id === last_id) ?? stored[0];
      if (!target) {
        if (!cancelled) setState("login");
        return;
      }
      try {
        await useStudioStore.getState().connectServer(target.id);
        localStorage.setItem(LAST_KEY, target.id);
        // Already signed in and opened an invite link: use it now.
        const joined = await redeem_join(apiUrl());
        if (joined && joined.id !== target.org_id) {
          await open_org(apiUrl(), joined);
        } else if (!cancelled) {
          setState("ready");
        }
      } catch (e) {
        if (!cancelled) {
          // Not signed in here: the sign in buttons are the answer, no error.
          if (!isSignedOut(e))
            setGateError(friendlyConnectError(target.name || target.url, e));
          setState("login");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, stored, last_id, redeem_join, open_org]);

  const cancel_connect = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setGateError(null);
    setState("login");
  }, []);

  function handle_connect(result: ConnectResult) {
    void useStudioStore
      .getState()
      .connectServer(result.profileId)
      .then(() => setState("ready"))
      .catch((e) => setGateError(String(e)));
  }

  function handle_org_select(org: Organization) {
    if (!oauth_session) return;
    setOrgBusy(true);
    void open_org(oauth_session.url, org)
      .catch((e) => setGateError(String(e)))
      .finally(() => setOrgBusy(false));
  }

  return (
    <>
      {children}
      <DialogPrimitive.Root open={state !== "ready"} onOpenChange={() => {}}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-100 bg-black/50" />
          <DialogPrimitive.Popup className="bg-card fixed top-[50%] left-[50%] z-100 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-xl">
            <DialogPrimitive.Title className="text-lg font-semibold">
              dh-studio — sign in
            </DialogPrimitive.Title>
            {state === "connecting" ? (
              <>
                <DialogPrimitive.Description className="text-muted-foreground mt-1 text-sm">
                  Connecting to your last server…
                </DialogPrimitive.Description>
                <div className="text-muted-foreground mt-6 flex items-center gap-2.5 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Connecting…
                </div>
                <div className="mt-4">
                  <Button variant="ghost" size="sm" onClick={cancel_connect}>
                    Try a different server
                  </Button>
                </div>
              </>
            ) : state === "claim" && claim_ticket ? (
              <div className="mt-4">
                <ClaimServerStep
                  url={apiUrl()}
                  ticket={claim_ticket}
                  onClaimed={(r) => {
                    setOAuthSession({ url: apiUrl(), me: r.me });
                    setState("org-pick");
                  }}
                  onCancel={() => setState("login")}
                />
              </div>
            ) : state === "org-pick" ? (
              oauth_session ? (
                <div className="mt-4">
                  <OrgPickerStep
                    me={oauth_session.me}
                    url={oauth_session.url}
                    busy={org_busy}
                    error={gate_error}
                    onSelect={handle_org_select}
                  />
                </div>
              ) : (
                <div className="text-muted-foreground mt-6 flex items-center gap-2.5 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Finishing sign-in…
                </div>
              )
            ) : (
              <div className="mt-4">
                {join_code && (
                  <p className="text-muted-foreground mb-3 text-sm">
                    You opened an invite link. Sign in with an account that
                    already exists here to use it.
                  </p>
                )}
                <ConnectServerForm
                  error={gate_error}
                  on_connect={handle_connect}
                />
              </div>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
