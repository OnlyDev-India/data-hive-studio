import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";
import {
  WEB,
  apiUrl,
  deriveServerId,
  webAddServer,
  webListServers,
  type WebServerConfig,
} from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import {
  ConnectServerForm,
  type ConnectResult,
} from "@/shared/components/connect-server-dialog";
import { Button } from "@/shared/components/ui/button";

interface GateProps {
  children: React.ReactNode;
}

type GateState = "connecting" | "login" | "ready";

const LAST_KEY = "dh.web.last";
const CONNECT_TIMEOUT_MS = 10_000;

export function WebGate({ children }: GateProps) {
  const [stored] = useState<WebServerConfig[]>(() =>
    WEB ? webListServers() : [],
  );
  const [last_id] = useState<string | null>(() =>
    WEB ? localStorage.getItem(LAST_KEY) : null,
  );
  const [state, setState] = useState<GateState>(() => {
    if (!WEB) return "ready";
    return stored.length === 0 ? "login" : "connecting";
  });
  const [gate_error, setGateError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setGateError(`${target.name || target.url}: ${String(e)}`);
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
    // Use a deterministic ID derived from the server URL (+ team, so multiple
    // teams on one same-origin deployment don't collide) so re-connecting to
    // the same server/team overwrites the existing config instead of
    // appending a new one every time (previously web_${Date.now()} leaked
    // duplicates).
    const base_url = (result.server_url ?? apiUrl()).replace(/\/+$/, "");
    const id = deriveServerId(base_url, result.team_name);
    const cfg: WebServerConfig = {
      id,
      url: base_url,
      token: result.token,
      name: result.server_name || result.team_name || "web-client",
      ...(result.team_name ? { team_name: result.team_name } : {}),
    };
    webAddServer(cfg);
    void useStudioStore
      .getState()
      .connectServer(cfg.id)
      .then(() => setState("ready"))
      .catch((e) => setGateError(String(e)));
  }

  return (
    <>
      {children}
      <DialogPrimitive.Root open={state !== "ready"} onOpenChange={() => {}}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-100 bg-black/50" />
          <DialogPrimitive.Popup className="bg-card fixed top-[50%] left-[50%] z-100 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-xl">
            <DialogPrimitive.Title className="text-lg font-semibold">
              dh-studio — team server
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
            ) : (
              <ConnectServerForm
                error={gate_error}
                on_connect={handle_connect}
              />
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
