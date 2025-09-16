"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getServerLogsAction,
  clearServerLogsAction,
  getServerStatusAction,
} from "../lib/actions/server";
import { LogEntry } from "../lib/custom-server";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";

interface UseServerLogsReturn {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  fetchLogs: (limit?: number, level?: LogEntry["level"]) => Promise<void>;
  clearLogs: () => Promise<void>;
  refreshLogs: () => Promise<void>;
  filter: {
    limit?: number;
    level?: LogEntry["level"] | "all";
    autoRefresh?: boolean;
  };
  setFilter: (filter: {
    limit?: number;
    level?: LogEntry["level"] | "all";
    autoRefresh?: boolean;
  }) => void;
}

export const useServerLogs = (
  refreshInterval: number = 5000,
): UseServerLogsReturn => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<{
    limit?: number;
    level?: LogEntry["level"] | "all";
    autoRefresh?: boolean;
  }>({ limit: 100, level: "all", autoRefresh: true });
  const { currentAPI } = useSelector((state: RootState) => state.api);

  const fetchLogs = useCallback(
    async (limit?: number, level?: LogEntry["level"]) => {
      if(!filter.autoRefresh) {
        setLoading(true);
      }
      setError(null);

      try {
        if(!currentAPI) {
          throw new Error("API not found");
        }
        const response = await getServerLogsAction(currentAPI, limit, level);

        if (response.success) {
          setLogs(response.logs || []);
          setTotalCount(response.totalCount || 0);
        } else {
          setError(response.error || "Failed to fetch logs");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch logs");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearLogs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      if(!currentAPI) {
        throw new Error("API not found");
      }
      const response = await clearServerLogsAction(currentAPI);

      if (response.success) {
        setLogs([]);
        setTotalCount(0);
      } else {
        setError(response.error || "Failed to clear logs");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear logs");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    await fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh effect
  useEffect(() => {
    if (!filter.autoRefresh) return;

    const interval = setInterval(() => {
      fetchLogs(
        filter.limit,
        filter.level === "all" ? undefined : filter.level,
      );
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [filter, refreshInterval, fetchLogs]);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return {
    logs,
    loading,
    error,
    totalCount,
    fetchLogs,
    clearLogs,
    refreshLogs,
    filter,
    setFilter,
  };
};
