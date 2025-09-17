"use client";

import React, { useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// import { ScrollArea } from '@/components/ui/scroll-area';
import {
  RefreshCw,
  Trash2, Download,
  AlertCircle,
  Info,
  AlertTriangle,
  Bug
} from "lucide-react";
import { useServerLogs } from "../hooks/useServerLogs";
import { LogEntry } from "../lib/custom-server";
import LogDisplay from "./log-display";

const ServerLogs: React.FC = () => {
  const {
    logs,
    loading,
    error,
    totalCount,
    fetchLogs,
    clearLogs,
    refreshLogs,
    filter,
    setFilter,
  } = useServerLogs(3000);

  const handleClearLogs = useCallback(() => {
    clearLogs();
  }, [clearLogs]);

  const handleExportLogs = useCallback(() => {
    const logData = logs.map((log) => ({
      timestamp: log.timestamp.toISOString(),
      level: log.level,
      message: log.message,
      data: log.data,
    }));

    const blob = new Blob([JSON.stringify(logData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `server-logs-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [logs]);

  const handleSelectLevel = useCallback(
    (value: LogEntry["level"] | "all") => {
      setFilter({ ...filter, level: value });
      fetchLogs(filter.limit, value === "all" ? undefined : value);
    },
    [filter, fetchLogs],
  );

  return (
    <div className="flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="limit">Limit:</Label>
            <Input
              id="limit"
              type="number"
              value={filter.limit}
              onChange={(e) =>
                setFilter({ ...filter, limit: Number(e.target.value) })
              }
              className="w-20 h-7"
              min="1"
              max="1000"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="level">Level:</Label>
            <Select value={filter.level} onValueChange={handleSelectLevel}>
              <SelectTrigger className="w-32 py-1 h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoRefresh"
              checked={filter.autoRefresh}
              onChange={(e) =>
                setFilter({ ...filter, autoRefresh: e.target.checked })
              }
              className="rounded"
            />
            <Label htmlFor="autoRefresh" className="text-sm">
              Auto-refresh
            </Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refreshLogs}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportLogs}
            disabled={logs.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearLogs}
            disabled={loading || logs.length === 0}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <LogDisplay logs={logs} loading={loading} error={error} />
    </div>
  );
};

export default ServerLogs;
