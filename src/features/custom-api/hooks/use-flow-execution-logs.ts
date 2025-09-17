import { useState, useEffect, useCallback } from "react";
import { FlowExecutionLog } from "../lib/custom-server";
import {
  getFlowExecutionLogsAction,
  getFlowExecutionLogAction,
  getLatestFlowExecutionLogAction,
} from "../lib/actions/server";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";

interface UseFlowExecutionLogsProps {
  endpointId: string;
  refreshInterval?: number;
}

export const useFlowExecutionLogs = ({
  endpointId,
  refreshInterval = 5000,
}: UseFlowExecutionLogsProps) => {
  const [flowExecutionLogs, setFlowExecutionLogs] = useState<
    FlowExecutionLog[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentAPI } = useSelector((state: RootState) => state.api);

  const fetchFlowExecutionLogs = useCallback(
    async (showLoading = true) => {
      if (!currentAPI) return;

      try {
        if (showLoading) {
          setLoading(true);
        }
        setError(null);

        const response = await getFlowExecutionLogsAction(
          currentAPI,
          endpointId,
        );

        if (response.success && response.logs) {
          const logs = JSON.parse(response.logs);
          setFlowExecutionLogs(logs || []);
        } else {
          setError(response.error || "Failed to fetch flow execution logs");
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to fetch flow execution logs",
        );
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [endpointId, currentAPI],
  );

  const getLatestFlowExecutionLog = useCallback(async () => {
    if (!currentAPI) return null;

    try {
      const response = await getLatestFlowExecutionLogAction(
        currentAPI,
        endpointId,
      );
      return response.success ? response.log : null;
    } catch (err) {
      console.error("Failed to get latest flow execution log:", err);
      return null;
    }
  }, [endpointId, currentAPI]);

  const getFlowExecutionLog = useCallback(
    async (executionId: string) => {
      if (!currentAPI) return null;

      try {
        const response = await getFlowExecutionLogAction(
          currentAPI,
          endpointId,
          executionId,
        );
        return response.success ? response.log : null;
      } catch (err) {
        console.error("Failed to get flow execution log:", err);
        return null;
      }
    },
    [endpointId, currentAPI],
  );

  // Auto-refresh effect
  useEffect(() => {
    const interval = setInterval(() => {
      fetchFlowExecutionLogs(false); // Don't show loading for auto-refresh
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [fetchFlowExecutionLogs, refreshInterval]);

  // Initial fetch
  useEffect(() => {
    fetchFlowExecutionLogs();
  }, [fetchFlowExecutionLogs]);

  return {
    flowExecutionLogs,
    loading,
    error,
    fetchFlowExecutionLogs,
    getLatestFlowExecutionLog,
    getFlowExecutionLog,
  };
};
