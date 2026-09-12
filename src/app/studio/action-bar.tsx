import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { prettyKind } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  useActiveConnection,
  usePaneMode,
  useStudioStore,
  useWorkspace,
  tabKey,
  tabLabel,
  type GridBridge,
} from "@/shared/store";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import { ExportMenu } from "@/features/data-export";
import { NotificationBell } from "@/features/notifications";
import { formatQueryPreview } from "./query-preview";
import { IconTypeMap } from "@/shared/components/icons/types";

export function ActionBar() {
  const conn = useActiveConnection();
  const ws = useWorkspace(conn?.id ?? "");
  const active = ws.active;
  const active_key = active ? tabKey(active) : null;
  const bridge = useStudioStore((s) =>
    active_key ? s.gridBridges[active_key] : null,
  );
  const is_schema_pane_kind =
    active?.kind === "table" || active?.kind === "mongo";
  const paneMode = usePaneMode(
    conn?.id ?? "",
    is_schema_pane_kind && active_key ? active_key : "",
  );
  const leftPanelOpen = useStudioStore((s) => s.leftPanelOpen);
  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);
  // New-table tab registers its create action under its tab key — the button
  // shows only while a NEW-TABLE tab is active, enabled only when valid.
  const newTable = useStudioStore((s) =>
    active?.kind === "new-table" && active_key
      ? (s.newTables[active_key] ?? null)
      : null,
  );
  // A SQL / Mongo-console tab registers a handle here; the action bar surfaces
  // the Run-all / Run-selection buttons while that tab is active.
  const sqlConsole = useStudioStore((s) =>
    (active?.kind === "sql" || active?.kind === "mongo-console") && active_key
      ? (s.sqlTabs[active_key] ?? null)
      : null,
  );
  // Status-bar-only text — what the grid is effectively running, built from
  // the SAME structured op it already exposes for exports, so it can never
  // disagree with the actual filters/sort in effect.
  const is_mongo_like = conn?.kind === "mongodb" || conn?.kind === "documentdb";
  const query_preview =
    bridge && paneMode === "data"
      ? formatQueryPreview(
          bridge.get_filtered_op(),
          bridge.page_size,
          is_mongo_like,
        )
      : null;

  return (
    <TooltipProvider delay={500}>
      <footer className="bg-muted/60 text-muted-foreground flex h-9 shrink-0 items-stretch overflow-hidden border-t text-xs select-none">
        {/* Section 1 — empty spacer, kept for layout: this used to hold the
            disconnect button, now moved to the sidebar's database row
            context menu (see `TablesBrowser` in tables-view.tsx). */}
        <div className="w-14 shrink-0 border-r" />
        {/* Section 2 — connection details (flows with the sidebar width) */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 overflow-hidden border-r px-3",
            !leftPanelOpen && "hidden",
          )}
          style={{ width: sidebarWidth }}
          aria-hidden={!leftPanelOpen}
        >
          <span className="text-foreground/80 max-w-40 truncate font-medium">
            {conn ? conn.name : "No connection"}
          </span>
          {conn && (
            <span className="text-3xs shrink-0 tracking-wide uppercase">
              {prettyKind(conn.kind)}
            </span>
          )}
          <span className="bg-border mx-0.5 h-3 w-px shrink-0" aria-hidden />
          <span className="truncate">
            {conn ? "Ready" : "Open a database to get started"}
          </span>
        </div>
        {/* Section 3 — active tab info + grid controls */}
        <div className="flex min-w-0 flex-1 scrollbar-none items-center gap-2 overflow-x-auto px-3">
          {active ? (
            <>
              {IconTypeMap[active.kind]}
              <span className="text-foreground/80 max-w-40 truncate font-medium">
                {tabLabel(active)}
              </span>
              {bridge && (
                <>
                  {bridge.elapsed_ms !== null && (
                    <span className="text-muted-foreground/80 shrink-0">
                      {bridge.elapsed_ms} ms
                    </span>
                  )}
                  <span className="text-muted-foreground/80 shrink-0">
                    {bridge.rows} of {bridge.total} rows
                  </span>
                  {query_preview && (
                    <code
                      className="text-muted-foreground/70 text-2xs min-w-0 truncate font-mono"
                      title={query_preview}
                    >
                      {query_preview}
                    </code>
                  )}
                </>
              )}
              {!bridge && sqlConsole?.result && (
                <>
                  <span className="text-muted-foreground/80 shrink-0">
                    {sqlConsole.result.elapsed_ms} ms
                  </span>
                  <span className="text-muted-foreground/80 shrink-0">
                    {sqlConsole.result.rows}{" "}
                    {sqlConsole.result.is_select ? "rows" : "row(s) affected"}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="truncate">No tab open</span>
          )}
          {/* Divider between the status text above and the grid controls
              below — the reference direction called for reading these as
              two distinct clusters instead of one dense row. */}
          {active && (
            <span className="bg-border mx-1 h-4 w-px shrink-0" aria-hidden />
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {bridge && paneMode === "data" && (
              <>
                <LimitInput
                  value={bridge.page_size}
                  onChange={bridge.set_page_size}
                />
                <Pagination bridge={bridge} />
                <ActionBarTooltip label="Download">
                  <ExportMenu bridge={bridge} conn_id={conn?.id ?? ""} />
                </ActionBarTooltip>
              </>
            )}
            {newTable && (
              <ActionBarTooltip
                label={
                  newTable.valid
                    ? "Create table"
                    : "Fix the table definition first"
                }
              >
                <Button
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={newTable.creating || !newTable.valid}
                  onClick={() => newTable.create()}
                >
                  {newTable.creating ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  {newTable.creating ? "Creating…" : "Create table"}
                </Button>
              </ActionBarTooltip>
            )}
            <ActionBarTooltip label="Notifications">
              <NotificationBell />
            </ActionBarTooltip>
          </div>
        </div>
      </footer>
    </TooltipProvider>
  );
}

function Pagination({
  bridge,
}: {
  bridge: Pick<GridBridge, "page" | "total_pages" | "set_page">;
}) {
  return (
    <div className="flex items-center rounded-md border">
      <Button
        variant="ghost"
        size="iconXs"
        className="rounded-r-none"
        disabled={bridge.page === 0}
        onClick={() => bridge.set_page(bridge.page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      <span className="text-2xs flex h-6 shrink-0 items-center border-x px-1.5">
        {bridge.page + 1} / {bridge.total_pages}
      </span>
      <Button
        variant="ghost"
        size="iconXs"
        className="rounded-l-none"
        disabled={bridge.page + 1 >= bridge.total_pages}
        onClick={() => bridge.set_page(bridge.page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  );
}

function LimitInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Math.max(1, Math.floor(Number(text) || 0));
    setText(String(n));
    if (n !== value) onChange(n);
  };
  return (
    <div className="flex h-6 items-center gap-1 rounded-md border px-1.5">
      <span className="text-3xs tracking-wide uppercase">Limit</span>
      <Input
        type="number"
        min={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-10 rounded-none border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

function ActionBarTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // Base UI merges its listeners and positioning ref into `render`, so it
  // must be a real element — a Fragment swallows both and the tooltip never
  // opens. A plain span keeps this working for any child (buttons, menus).
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
