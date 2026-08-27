import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FileCode2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { prettyKind } from "@/shared/api";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { TabTypeIcon } from "@/shared/components/tab-type-icon";
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

export function ActionBar({ on_disconnect }: { on_disconnect: () => void }) {
  const conn = useActiveConnection();
  const ws = useWorkspace(conn?.id ?? "");
  const active = ws.active;
  const active_key = active ? tabKey(active) : null;
  const bridge = useStudioStore((s) =>
    active_key ? s.gridBridges[active_key] : null,
  );
  const schemaEdit = useStudioStore((s) =>
    active_key ? (s.schemaEdits[active_key] ?? null) : null,
  );
  // Refresh / Drop-table for the active table pane while its Schema editor
  // is open (registered by SchemaTab via the store).
  const paneMode = usePaneMode(
    conn?.id ?? "",
    active?.kind === "table" && active_key ? active_key : "",
  );
  const schemaPane = useStudioStore((s) =>
    active?.kind === "table" && active_key
      ? (s.schemaPanes[active_key] ?? null)
      : null,
  );
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);
  const openSql = useStudioStore((s) => s.openSql);
  // New-table tab registers its create action under its tab key — the button
  // shows only while a NEW-TABLE tab is active, enabled only when valid.
  const newTable = useStudioStore((s) =>
    active?.kind === "new-table" && active_key
      ? (s.newTables[active_key] ?? null)
      : null,
  );

  return (
    <TooltipProvider delay={500}>
      <footer className="bg-muted/60 text-muted-foreground flex h-9 shrink-0 items-stretch overflow-hidden border-t text-xs select-none">
        {/* Section 1 — disconnect */}
        <div
          className="bg-background flex w-14 shrink-0 items-center justify-center border-r"
          title={conn ? conn.name : "No connection"}
        >
          <Button
            variant="ghost"
            size="iconXs"
            disabled={!conn}
            onClick={on_disconnect}
            title={conn ? "Disconnect" : "No connection to disconnect"}
          >
            <Unplug className="size-3.5" />
          </Button>
        </div>
        {/* Section 2 — connection details (flows with the sidebar width) */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 overflow-hidden border-r px-3",
            !sidebarOpen && "hidden",
          )}
          style={{ width: sidebarWidth }}
          aria-hidden={!sidebarOpen}
        >
          <span className="text-foreground/80 max-w-40 truncate font-medium">
            {conn ? conn.name : "No connection"}
          </span>
          {conn && (
            <span className="shrink-0 text-[10px] tracking-wide uppercase">
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
              <TabTypeIcon tab={active} />
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
                </>
              )}
            </>
          ) : (
            <span className="truncate">No tab open</span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {bridge && paneMode === "data" && (
              <>
                <LimitInput
                  value={bridge.page_size}
                  onChange={bridge.set_page_size}
                />
                <Pagination bridge={bridge} />
                {bridge.has_full_row && (
                  <ActionBarTooltip label="Delete Row(s)">
                    <Button
                      variant="ghost"
                      size="iconXs"
                      disabled={!bridge.editable}
                      title={`Delete selected rows (${bridge.selected_count})`}
                      onClick={() => bridge.delete_rows()}
                      className={
                        "text-destructive/70 bg-destructive/10 hover:text-destructive hover:bg-destructive/20"
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </ActionBarTooltip>
                )}
                {bridge.pending_exists && (
                  <>
                    <Button
                      size="sm"
                      className="h-6 rounded-r-none px-2 text-xs"
                      disabled={bridge.loading}
                      title="Insert the new rows"
                      onClick={() => bridge.apply_pending()}
                    >
                      {bridge.loading ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Apply
                      {bridge.pending_count > 1
                        ? ` (${bridge.pending_count})`
                        : ""}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="iconXs"
                            disabled={bridge.loading}
                            aria-label="Pending edits options"
                            title="Pending edits options"
                            className={"-ml-0.5 rounded-l-none"}
                          />
                        }
                      >
                        <ChevronUp className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            const sql = bridge.get_pending_sql();
                            if (sql && conn) openSql(conn.id, sql);
                          }}
                        >
                          <FileCode2 className="size-3.5" />
                          Copy to SQL
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <ActionBarTooltip label="Reset Changes">
                      <Button
                        variant="ghost"
                        size="iconXs"
                        disabled={bridge.loading}
                        title="Discard the new row"
                        onClick={() => bridge.cancel_pending()}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </ActionBarTooltip>
                  </>
                )}
                <ActionBarTooltip label="Download">
                  <ExportMenu bridge={bridge} conn_id={conn?.id ?? ""} />
                </ActionBarTooltip>
                <ActionBarTooltip label="Add Row">
                  <Button
                    variant="ghost"
                    size="iconXs"
                    disabled={!bridge.editable}
                    aria-label="Add a new row"
                    onClick={() => bridge.start_pending()}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </ActionBarTooltip>
                <ActionBarTooltip label="Refresh">
                  <Button
                    variant="ghost"
                    size="iconXs"
                    title="Refresh"
                    disabled={bridge.loading}
                    onClick={() => bridge.refresh()}
                  >
                    <RefreshCw
                      className={cn("size-3.5", {
                        "animate-spin": bridge.loading,
                      })}
                    />
                  </Button>
                </ActionBarTooltip>
              </>
            )}
            {/* Schema editor tools — moved here from the tab header. */}
            {schemaEdit && paneMode == "schema" && (
              <>
                <span className="text-muted-foreground/80 shrink-0">
                  {schemaEdit.busy
                    ? "Applying…"
                    : `${schemaEdit.count} schema change${schemaEdit.count === 1 ? "" : "s"}`}
                </span>
                <Button
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={schemaEdit.busy || schemaEdit.count === 0}
                  onClick={() => schemaEdit.apply()}
                >
                  {schemaEdit.busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                  {schemaEdit.busy
                    ? "Applying…"
                    : `Apply (${schemaEdit.count})`}
                </Button>
                <Button
                  variant="ghost"
                  size="iconXs"
                  title="Discard schema changes"
                  disabled={schemaEdit.busy}
                  onClick={() => schemaEdit.discard()}
                >
                  <X className="size-3.5" />
                </Button>
              </>
            )}

            {active?.kind === "table" &&
              paneMode === "schema" &&
              schemaPane && (
                <>
                  <ActionBarTooltip label="Drop table">
                    <Button
                      variant="ghost"
                      size="iconXs"
                      aria-label="Drop table"
                      disabled={schemaPane.busy}
                      onClick={() => schemaPane.drop()}
                      className={
                        "text-destructive/70 bg-destructive/10 hover:text-destructive hover:bg-destructive/20"
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </ActionBarTooltip>
                  <ActionBarTooltip label="Refresh schema">
                    <Button
                      variant="ghost"
                      size="iconXs"
                      aria-label="Refresh schema"
                      disabled={schemaPane.busy}
                      onClick={() => schemaPane.refresh()}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
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
      <span className="flex h-6 shrink-0 items-center border-x px-1.5 text-[11px]">
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
      <span className="text-[10px] tracking-wide uppercase">Limit</span>
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
        className="h-6 w-10 rounded-none border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
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
