import { useState } from "react";
import { Search } from "lucide-react";
import type { SessionState } from "@/shared/api";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Switch } from "@/shared/components/ui/switch";
import { clampSlowMs } from "@/shared/store";
import { STATE_LABEL, type MonitorFilters } from "../lib/sessions";

const ALL = "__all__";

function Pick({
  label,
  value,
  all_label,
  options,
  on_change,
}: {
  label: string;
  value: string | null;
  all_label: string;
  options: { value: string; label: string }[];
  on_change: (v: string | null) => void;
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(v) => on_change(v === ALL || v == null ? null : String(v))}
    >
      <SelectTrigger size="sm" aria-label={label} className="text-small h-7 max-w-44 min-w-28">
        <SelectValue>
          {(v: string) => (v === ALL ? all_label : options.find((o) => o.value === v)?.label ?? v)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all_label}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The slow limit in seconds, saved on Enter or when the field loses focus.
 *  Mounted with a `key` of the saved value, so a save elsewhere resets it. */
function SlowLimit({
  slow_ms,
  on_change,
}: {
  slow_ms: number;
  on_change: (ms: number) => void;
}) {
  const [text, setText] = useState(String(slow_ms / 1000));
  const commit = () => {
    const ms = clampSlowMs(Number(text) * 1000);
    setText(String(ms / 1000));
    if (ms !== slow_ms) on_change(ms);
  };
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor="monitor-slow" className="text-small text-muted-foreground font-normal">
        Slow after
      </Label>
      <Input
        id="monitor-slow"
        type="number"
        inputMode="decimal"
        min={0.5}
        step={0.5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className="text-small h-7 w-16 tabular-nums"
      />
      <span className="text-small text-muted-foreground">s</span>
    </div>
  );
}

/** The Sessions filters (AC-4), Show idle (AC-5) and the slow limit (AC-6).
 *  Every change filters the last snapshot again, with no new request. */
export function MonitorFiltersBar({
  filters,
  databases,
  users,
  show_idle,
  slow_ms,
  on_filters,
  on_show_idle,
  on_slow_ms,
}: {
  filters: MonitorFilters;
  databases: string[];
  users: string[];
  show_idle: boolean;
  slow_ms: number;
  on_filters: (f: MonitorFilters) => void;
  on_show_idle: (v: boolean) => void;
  on_slow_ms: (ms: number) => void;
}) {
  const states: SessionState[] = ["active", "idle_in_tx", "waiting", "idle"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pick
        label="Database"
        value={filters.database}
        all_label="All databases"
        options={databases.map((d) => ({ value: d, label: d }))}
        on_change={(database) => on_filters({ ...filters, database })}
      />
      <Pick
        label="User"
        value={filters.user}
        all_label="All users"
        options={users.map((u) => ({ value: u, label: u }))}
        on_change={(user) => on_filters({ ...filters, user })}
      />
      <Pick
        label="State"
        value={filters.state === "all" ? null : filters.state}
        all_label="All states"
        options={states.map((s) => ({ value: s, label: STATE_LABEL[s] }))}
        on_change={(state) =>
          on_filters({ ...filters, state: (state as SessionState | null) ?? "all" })
        }
      />
      <div className="relative min-w-40 flex-1 sm:max-w-72">
        <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <Input
          aria-label="Search query, app name or client"
          placeholder="Search query, app, client…"
          value={filters.search}
          onChange={(e) => on_filters({ ...filters, search: e.target.value })}
          className="text-small h-7 pl-7"
        />
      </div>
      <div className="ml-auto flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Switch id="monitor-show-idle" checked={show_idle} onCheckedChange={on_show_idle} />
          <Label htmlFor="monitor-show-idle" className="text-small font-normal">
            Show idle
          </Label>
        </div>
        <SlowLimit key={slow_ms} slow_ms={slow_ms} on_change={on_slow_ms} />
      </div>
    </div>
  );
}
