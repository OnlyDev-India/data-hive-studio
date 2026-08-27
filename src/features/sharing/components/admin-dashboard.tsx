import { useCallback, useEffect, useMemo, useState } from "react";
import {
  serversAdminDevices,
  serversAdminConnections,
  serversAdminTokensList,
} from "@/shared/api/client";
import { useStudioStore } from "@/shared/store";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import type { TokenInfo } from "@/shared/api/types";
import type { ConnLite, DeviceInfo, Tab } from "./types";
import { TABS } from "./types";
import { TokensList } from "./tokens-panel";
import { DevicesPanel } from "./devices-panel";
import { CreateTokenForm } from "./create-token-panel";

export function AdminDashboard({ profileId }: { profileId: string }) {
  const [tab, setTab] = useState<Tab>("tokens");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [conns, setConns] = useState<ConnLite[]>([]);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const tokenStrings = useMemo(
    () => new Set(tokens.map((t) => t.token)),
    [tokens],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [devs, cs, toks] = await Promise.all([
        serversAdminDevices<DeviceInfo[]>(profileId),
        serversAdminConnections<ConnLite[]>(profileId),
        serversAdminTokensList<TokenInfo[]>(profileId),
      ]);
      setDevices(devs);
      setConns(cs);
      setTokens(toks);
    } catch (e) {
      useStudioStore
        .getState()
        .pushNotification({
          kind: "error",
          title: "Failed to load admin data",
          detail: String(e),
        });
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void refresh();
  }, [refresh]);

  function navigateToToken(token: string) {
    setTab("tokens");
    setFilter(token);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar — same visual language as the editor tab strip */}
      <div
        className="bg-background flex w-full shrink-0 items-center gap-1 overflow-x-auto border-b pl-1.5"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 cursor-pointer rounded-t-md border-b-2 px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors select-none",
              tab === t.key
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        {/* Toolbar (search + reload) — visible on list tabs only */}
        {(tab === "tokens" || tab === "devices") && (
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder={
                  tab === "tokens"
                    ? "Search tokens by user or team…"
                    : "Search devices by name…"
                }
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw
                className={cn("size-3.5", loading && "animate-spin")}
              />
              Reload
            </Button>
          </div>
        )}
        {loading ? (
          <p className="text-muted-foreground py-4 text-sm">Loading…</p>
        ) : tab === "tokens" ? (
          <TokensList
            tokens={tokens}
            filter={filter.trim().toLowerCase()}
            profileId={profileId}
            conns={conns}
            onRefresh={() => void refresh()}
          />
        ) : tab === "devices" ? (
          <DevicesPanel
            devices={devices}
            filter={filter.trim().toLowerCase()}
            profileId={profileId}
            tokenStrings={tokenStrings}
            onTokenClick={navigateToToken}
          />
        ) : (
          <CreateTokenForm
            profileId={profileId}
            conns={conns}
            on_created={() => void refresh()}
          />
        )}
      </div>
    </div>
  );
}
