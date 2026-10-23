/** The server monitor's saved settings for one connection (spec 0025),
 *  kept in the workspace snapshot as `SavedWorkspace.monitorSettings`. */
export interface MonitorSettings {
  /** 0 is Paused. */
  refresh_ms: MonitorRefreshMs;
  slow_ms: number;
  show_idle: boolean;
}

export const MONITOR_REFRESH_CHOICES = [
  1000, 2000, 5000, 10000, 30000, 0,
] as const;

export type MonitorRefreshMs = (typeof MONITOR_REFRESH_CHOICES)[number];

export const SLOW_MS_MIN = 500;
export const SLOW_MS_MAX = 3_600_000;

export const DEFAULT_MONITOR_SETTINGS: MonitorSettings = {
  refresh_ms: 2000,
  slow_ms: 5000,
  show_idle: false,
};

/** A slow limit inside the allowed range, whole milliseconds. */
export function clampSlowMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_MONITOR_SETTINGS.slow_ms;
  return Math.min(SLOW_MS_MAX, Math.max(SLOW_MS_MIN, Math.round(ms)));
}

/** Saved settings as the tab uses them: an unknown rate loads as 2 seconds,
 *  the slow limit is clamped, anything missing takes its default. */
export function normalizeMonitorSettings(raw: unknown): MonitorSettings {
  const r = (raw ?? {}) as Partial<Record<keyof MonitorSettings, unknown>>;
  const refresh = (MONITOR_REFRESH_CHOICES as readonly unknown[]).includes(
    r.refresh_ms,
  )
    ? (r.refresh_ms as MonitorRefreshMs)
    : DEFAULT_MONITOR_SETTINGS.refresh_ms;
  return {
    refresh_ms: refresh,
    slow_ms:
      typeof r.slow_ms === "number"
        ? clampSlowMs(r.slow_ms)
        : DEFAULT_MONITOR_SETTINGS.slow_ms,
    show_idle: r.show_idle === true,
  };
}
