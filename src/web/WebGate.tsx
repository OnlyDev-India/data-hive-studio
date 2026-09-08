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
import { useStudioStore } from "@/shared/store";
import {
  friendlyConnectError,
  type MeResult,
  type Organization,
} from "@/shared/api/server-admin";
import {
  ConnectServerForm,
  OrgPickerStep,
  type ConnectResult,
} from "@/shared/components/connect-server-dialog";
import { Button } from "@/shared/components/ui/button";

interface GateProps {
  children: React.ReactNode;
}

type GateState = "connecting" | "login" | "org-pick" | "ready";

const LAST_KEY = "dh.web.last";
const CONNECT_TIMEOUT_MS = 10_000;

/** Recover an OAuth callback's `?token=` from the current URL (appended by
 *  `router.rs::auth_callback` after a `/auth/{provider}/start` round trip —
 *  see `webOAuthStartUrl`), stripping it from the address bar immediately so
 *  a refresh doesn't try to redeem it again. */
function takePendingToken(): string | null {
  if (!WEB || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) return null;
  params.delete("token");
  const rest = params.toString();
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (rest ? `?${rest}` : ""),
  );
  return token;
}

export function WebGate({ children }: GateProps) {
  const [stored] = useState<WebServerConfig[]>(() =>
    WEB ? webListServers() : [],
  );
  const [last_id] = useState<string | null>(() =>
    WEB ? localStorage.getItem(LAST_KEY) : null,
  );
  const [pending_token] = useState<string | null>(() => takePendingToken());
  const [state, setState] = useState<GateState>(() => {
    if (!WEB) return "ready";
    if (pending_token) return "org-pick";
    return stored.length === 0 ? "login" : "connecting";
  });
  const [gate_error, setGateError] = useState<string | null>(null);
  const [oauth_session, setOAuthSession] = useState<{
    url: string;
    token: string;
    me: MeResult;
  } | null>(null);
  const [org_busy, setOrgBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the pending OAuth token (if any) into an identity + org list.
  useEffect(() => {
    if (!WEB || !pending_token || state !== "org-pick") return;
    let cancelled = false;
    void (async () => {
      const url = apiUrl();
      try {
        const me = await wcall<MeResult>(
          "GET",
          "/v1/me",
          undefined,
          url,
          pending_token,
        );
        if (!cancelled) setOAuthSession({ url, token: pending_token, me });
      } catch (e) {
        if (!cancelled) {
          setGateError(`Sign-in failed: ${String(e)}`);
          setState("login");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending_token, state]);

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
        if (!cancelled) setState("ready");
      } catch (e) {
        if (!cancelled) {
          setGateError(friendlyConnectError(target.name || target.url, e));
          setState("login");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, stored, last_id]);

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
    const id = deriveServerId(oauth_session.url, org.id);
    webAddServer({
      id,
      url: oauth_session.url,
      token: oauth_session.token,
      name: org.name,
      org_id: org.id,
    });
    void useStudioStore
      .getState()
      .connectServer(id)
      .then(() => setState("ready"))
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
            ) : state === "org-pick" ? (
              oauth_session ? (
                <div className="mt-4">
                  <OrgPickerStep
                    me={oauth_session.me}
                    url={oauth_session.url}
                    token={oauth_session.token}
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
                <ConnectServerForm error={gate_error} on_connect={handle_connect} />
              </div>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
