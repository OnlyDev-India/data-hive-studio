import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { WEB } from "@/shared/api/web";

/** Asks for a password that wasn't remembered, and optionally saves it. */
export function PasswordPrompt({
  name,
  onSubmit,
  onCancel,
}: {
  /** The connection asking, or null when closed. */
  name: string | null;
  /** Rejects with the connect error to show it here. */
  onSubmit: (password: string, save: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPassword("");
    setSave(false);
    setError(null);
    onCancel();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(password, save);
      setPassword("");
      setSave(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={name !== null} onOpenChange={(o) => !o && !busy && close()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Password for {name}</DialogTitle>
            <DialogDescription>
              {save
                ? WEB
                  ? "Saved in this browser as plain text."
                  : "Saved on this computer, encrypted."
                : "Not saved. It is kept in memory for this connection only."}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            type="password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!error}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={save}
              onCheckedChange={(v) => setSave(v === true)}
            />
            Save password
          </label>
          {error && (
            <p
              role="alert"
              className="text-destructive wrap-break-words text-xs"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Connecting…" : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
