import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import {
  serversOAuthLogin,
  serversOAuthProviders,
  type ServerProfileView,
} from "@/shared/api/server-admin";
import { refusalMessage } from "@/shared/api/server-claim";
import {
  ClaimServerStep,
  FormError,
  PROVIDER_LABELS,
} from "@/shared/components/connect-server-dialog";

/**
 * Sign in again, for a server this app is signed out of (a renewal was
 * refused, or the person signed out). The profile, its org, open tabs and
 * unsaved editor text all stay: this only makes a new session for the
 * server's address, and `onSignedIn` reconnects the profile to it. Desktop
 * only: the web page shows its own sign in dialog when its session ends.
 */
export function SignInAgainDialog({
  profile,
  onOpenChange,
  onSignedIn,
}: {
  profile: ServerProfileView | null;
  onOpenChange: (v: boolean) => void;
  onSignedIn: (profile: ServerProfileView) => void | Promise<void>;
}) {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const url = profile?.url;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when a different server opens
    setProviders(null);
    setError(null);
    setClaim(null);
    serversOAuthProviders(url)
      .then((p) => !cancelled && setProviders(p))
      .catch(
        (e: unknown) =>
          !cancelled && setError(`Couldn't reach that server: ${String(e)}`),
      );
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function finish(p: ServerProfileView) {
    try {
      await onSignedIn(p);
      onOpenChange(false);
    } catch (e) {
      setError(String(e));
    }
  }

  async function signIn(provider: string) {
    if (!profile || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await serversOAuthLogin(profile.url, provider);
      if (result.kind === "signed_in") await finish(profile);
      else if (result.kind === "claim") setClaim(result.ticket);
      else setError(refusalMessage(result.error, result.email));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={profile !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign in again</DialogTitle>
          <DialogDescription>
            You're signed out of {profile?.name}. Sign in to pick up where you
            left off: your tabs and unsaved work stay as they are.
          </DialogDescription>
        </DialogHeader>
        {profile && claim ? (
          <ClaimServerStep
            url={profile.url}
            ticket={claim}
            onClaimed={() => void finish(profile)}
            onCancel={() => setClaim(null)}
          />
        ) : (
          <div className="grid gap-2">
            <FormError message={error} />
            {providers === null && !error ? (
              <div className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Checking sign-in
                options…
              </div>
            ) : (
              (providers ?? []).map((provider, i) => (
                <Button
                  key={provider}
                  variant={i === 0 ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => void signIn(provider)}
                >
                  {busy && <Loader2 className="mr-1 size-4 animate-spin" />}
                  {PROVIDER_LABELS[provider] ?? `Continue with ${provider}`}
                </Button>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
