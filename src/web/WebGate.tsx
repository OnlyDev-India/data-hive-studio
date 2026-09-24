import { useCallback, useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";
import {
  KEY_REJECTED_EVENT,
  WEB,
  setWebKey,
  webInfo,
  webKey,
  webKeyAccepted,
} from "@/shared/api/web";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

interface GateProps {
  children: React.ReactNode;
}

type GateState = "checking" | "prompt" | "unreachable" | "ready";

/** Ask the server what it needs and say where the gate goes next. */
async function resolveGate(): Promise<{
  state: GateState;
  error: string | null;
}> {
  try {
    const info = await webInfo();
    if (!info.key_required) return { state: "ready", error: null };
    const saved = webKey();
    if (saved && (await webKeyAccepted(saved))) {
      return { state: "ready", error: null };
    }
    return { state: "prompt", error: null };
  } catch (e) {
    return { state: "unreachable", error: String(e) };
  }
}

/**
 * The web page has no sign in (spec 0010). The one thing it may ask for is
 * the server's access key, and only when `GET /v1/info` says the server has
 * one. The key is kept in `sessionStorage` (this tab only). A 401 from any
 * call brings the prompt back.
 */
export function WebGate({ children }: GateProps) {
  const [state, setState] = useState<GateState>(WEB ? "checking" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(() => {
    void resolveGate().then((next) => {
      setState(next.state);
      setError(next.error);
    });
  }, []);

  useEffect(() => {
    if (WEB) check();
  }, [check]);

  const retry = () => {
    setError(null);
    setState("checking");
    check();
  };

  // A call was refused for its key: ask again.
  useEffect(() => {
    if (!WEB) return;
    const onRejected = () => {
      setKey("");
      setError("The access key was not accepted. Enter it again.");
      setState("prompt");
    };
    window.addEventListener(KEY_REJECTED_EVENT, onRejected);
    return () => window.removeEventListener(KEY_REJECTED_EVENT, onRejected);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = key.trim();
    if (!candidate || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (await webKeyAccepted(candidate)) {
        setWebKey(candidate);
        setKey("");
        setState("ready");
      } else {
        setError("That key was not accepted.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      <DialogPrimitive.Root open={state !== "ready"} onOpenChange={() => {}}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-100 bg-black/50" />
          <DialogPrimitive.Popup className="bg-card fixed top-[50%] left-[50%] z-100 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-6 shadow-xl">
            {state === "prompt" ? (
              <form onSubmit={(e) => void submit(e)}>
                <DialogPrimitive.Title className="text-lg font-semibold">
                  Access key
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-muted-foreground mt-1 text-sm">
                  This server asks for an access key before it will connect to a
                  database.
                </DialogPrimitive.Description>
                <Input
                  autoFocus
                  type="password"
                  autoComplete="off"
                  aria-label="Key"
                  className="mt-4"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                {error && (
                  <p className="text-destructive mt-2 text-xs">{error}</p>
                )}
                <div className="mt-4 flex justify-end">
                  <Button type="submit" disabled={busy || !key.trim()}>
                    {busy ? "Checking…" : "Continue"}
                  </Button>
                </div>
              </form>
            ) : state === "unreachable" ? (
              <>
                <DialogPrimitive.Title className="text-lg font-semibold">
                  Cannot reach the server
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-destructive mt-2 text-xs break-words">
                  {error}
                </DialogPrimitive.Description>
                <div className="mt-4 flex justify-end">
                  <Button onClick={retry}>Try again</Button>
                </div>
              </>
            ) : (
              <>
                <DialogPrimitive.Title className="text-lg font-semibold">
                  DH Studio
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-muted-foreground mt-6 flex items-center gap-2.5 text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Connecting to the server…
                </DialogPrimitive.Description>
              </>
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
