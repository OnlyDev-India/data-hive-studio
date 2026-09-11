import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { WEB } from "@/shared/api/web";
import { Button, buttonVariants } from "@/shared/components/ui";
import { useStudioStore } from "@/shared/store";

const REPO = "OnlyDev-India/data-hive-studio";

/** Native desktop build only — nothing to read in a browser tab for any of
 *  these (`getVersion()` reads `tauri.conf.json`'s version out of the
 *  running binary; the rest come from `plugin-os`, native-only by nature). */
async function readSupportInfo(): Promise<{
  version: string | null;
  os: string | null;
  arch: string | null;
}> {
  if (WEB) return { version: null, os: null, arch: null };
  try {
    const [{ getVersion }, { platform, version: osVersion, arch }] =
      await Promise.all([
        import("@tauri-apps/api/app"),
        import("@tauri-apps/plugin-os"),
      ]);
    const PLATFORM_LABEL: Record<string, string> = {
      macos: "macOS",
      windows: "Windows",
      linux: "Linux",
    };
    const p = platform();
    return {
      version: await getVersion(),
      os: `${PLATFORM_LABEL[p] ?? p} ${osVersion()}`,
      arch: arch(),
    };
  } catch {
    return { version: null, os: null, arch: null };
  }
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/30 rounded-lg border px-3.5 py-2.5">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-0.5 font-mono text-sm">{value}</div>
    </div>
  );
}

/** "What am I running" page: app identity, version, support diagnostics, and
 *  where to find the source/report an issue. */
export function AboutSection() {
  const [info, setInfo] = useState<{
    version: string | null;
    os: string | null;
    arch: string | null;
  }>({ version: null, os: null, arch: null });
  const [copied, setCopied] = useState(false);
  const setUpdateDialogOpen = useStudioStore((s) => s.setUpdateDialogOpen);

  useEffect(() => {
    let cancelled = false;
    void readSupportInfo().then((v) => {
      if (!cancelled) setInfo(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function copy_support_info() {
    const lines = [
      `DH Studio ${info.version ?? "—"}`,
      `Runtime: ${WEB ? "Web" : "Desktop"}`,
      `OS: ${info.os ?? "—"}`,
      `Architecture: ${info.arch ?? "—"}`,
    ];
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-center gap-4">
        <img src="/icon.png" alt="" className="size-14 rounded-2xl" />
        <div>
          <h2 className="text-lg font-semibold">DH Studio</h2>
          <p className="text-muted-foreground text-sm">
            A native desktop client for your databases
          </p>
        </div>
      </div>

      <section className="rounded-xl border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Support information</h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Copy these details when filing issues or asking for help.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={copy_support_info}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy support info"}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <InfoTile label="Version" value={info.version ?? "—"} />
          <InfoTile label="Runtime" value={WEB ? "Web" : "Desktop"} />
          <InfoTile label="Operating System" value={info.os ?? "—"} />
          <InfoTile label="Architecture" value={info.arch ?? "—"} />
        </div>
      </section>

      <section className="flex items-center justify-between gap-4 rounded-xl border p-4">
        <div>
          <h3 className="text-sm font-semibold">Updates & source</h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Check for a newer release, or browse the code on GitHub.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!WEB && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setUpdateDialogOpen(true)}
            >
              <RefreshCw className="size-3.5" />
              Check for updates
            </Button>
          )}
          <a
            href={`https://github.com/${REPO}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5" })}
          >
            <ExternalLink className="size-3.5" />
            GitHub
          </a>
        </div>
      </section>
    </div>
  );
}
