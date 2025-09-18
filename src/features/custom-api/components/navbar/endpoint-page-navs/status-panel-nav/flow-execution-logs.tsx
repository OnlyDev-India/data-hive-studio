"use client";

import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Play,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowExecutionLog } from "@/features/custom-api/lib/custom-server";
import { useFlowExecutionLogs } from "@/features/custom-api/hooks/use-flow-execution-logs";
import { useParams } from "next/navigation";

// Timeline Chart Component
interface TimelineChartProps {
  nodeLogs: FlowExecutionLog["nodeLogs"];
  zoomLevel: number;
}

const TimelineChart: React.FC<TimelineChartProps> = ({
  nodeLogs,
  zoomLevel,
}) => {
  if (!nodeLogs || nodeLogs.length === 0) return null;

  // Skip the first node as it's just a start point
  const executionNodes = nodeLogs.slice(1);
  if (executionNodes.length === 0) return null;

  const startTime = new Date(nodeLogs[0].timestamp);

  const tasks = executionNodes.map((nodeLog, index) => {
    const nodeStartTime = new Date(nodeLog.timestamp);
    const actualExecutionTime = nodeLog.executionTime || 0;

    // For 0ms execution time, show a minimal bar (5ms width for visibility)
    const displayDuration = actualExecutionTime === 0 ? 5 : actualExecutionTime;
    const nodeEndTime = new Date(nodeStartTime.getTime() + displayDuration);

    // Calculate relative start time from the first node (in milliseconds)
    const relativeStart = nodeStartTime.getTime() - startTime.getTime();
    const relativeEnd = nodeEndTime.getTime() - startTime.getTime();
    const duration = relativeEnd - relativeStart;

    return {
      id: `node-${index + 1}`, // +1 because we skipped the first node
      name: nodeLog.nodeName,
      startTime: relativeStart,
      endTime: relativeEnd,
      duration: duration,
      status: nodeLog.status,
      executionTime: actualExecutionTime, // Keep original execution time for display
      displayDuration: displayDuration, // Use this for bar width calculation
    };
  });

  const maxTime = Math.max(...tasks.map((task) => task.endTime));
  const timeScale = zoomLevel / 100;

  // Ensure we have some padding at the end so bars don't get cut off
  const paddedMaxTime = maxTime + maxTime * 0.2; // Add 20% padding
  const timelineWidth = Math.max(paddedMaxTime * timeScale, 800);

  // Generate time markers - show every 100ms or so
  const timeMarkers = [];
  const interval = Math.max(100, Math.floor(paddedMaxTime / 8)); // Show about 8 markers
  for (let i = 0; i <= paddedMaxTime; i += interval) {
    timeMarkers.push(i);
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "executing":
        return <Play className="h-4 w-4 text-blue-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="h-full" style={{ minWidth: "50rem" }}>
      {/* Timeline Header */}
      <div className="sticky top-0 z-10 border-b border-border">
        <div className="flex">
          {/* Task Names Column */}
          <div className="sticky left-0 z-20 w-48 border-r border-border bg-secondary p-3">
            <div className="text-sm font-medium text-foreground">Tasks</div>
          </div>

          {/* Timeline Header */}
          <div
            className="relative flex-1 overflow-hidden"
            style={{ width: `${timelineWidth}px` }}
          >
            <div className="border-b border-border px-3 py-1 text-sm font-medium text-foreground">
              Timeline (ms)
            </div>

            {/* Time Markers */}
            <div className="relative h-10 bg-muted/20">
              {timeMarkers.map((time, index) => (
                <div
                  key={time}
                  className="absolute top-0 flex h-full flex-col justify-center"
                  style={{ left: `${(time / paddedMaxTime) * 100}%` }}
                >
                  {index > 0 && <div className="h-full w-px bg-border"></div>}
                  <p className="absolute left-2 top-2 truncate whitespace-nowrap text-xs text-foreground">
                    {time}ms
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      {/* <div
        className="overflow-auto"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      > */}
        {tasks.map((task, index) => (
          <div key={task.id} className="flex border-b border-border/50">
            {/* Task Info */}
            <div className="sticky left-0 flex min-h-[48px] w-48 items-center gap-3 border-r border-border bg-secondary px-3 py-1 z-20">
              {getStatusIcon(task.status)}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {task.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {task.executionTime}ms
                </div>
              </div>
            </div>

            {/* Timeline Bar for this task */}
            <div
              className="relative flex min-h-[48px] flex-1 items-center overflow-hidden"
              style={{ width: `${timelineWidth}px` }}
            >
              {/* Task Bar with Hover Card */}
              <HoverCard>
                <HoverCardTrigger asChild>
                  <div
                    className={cn(
                      "absolute flex h-7 cursor-pointer items-center justify-center rounded text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90"
                    )}
                    style={{
                      left: `${(task.startTime / paddedMaxTime) * 100}%`,
                      width: `${Math.max((task.displayDuration / paddedMaxTime) * 100, 0.5)}%`,
                      minWidth: "24px",
                      background: `
                        repeating-linear-gradient(
                          45deg,
                          hsl(var(--primary) / 0.7) 0px,
                          hsl(var(--primary) / 0.7) 8px,
                          hsl(var(--primary) / 0.6) 8px,
                          hsl(var(--primary) / 0.6) 16px
                        )
                      `,
                    }}
                  >
                    {task.duration > 80 && (
                      <span className="truncate px-2">
                        {task.executionTime}ms
                      </span>
                    )}
                  </div>
                </HoverCardTrigger>
                <HoverCardContent className="bg-secondary border-border border">
                  <div className="space-y-3 bg-dropdown-style">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(task.status)}
                      <h4 className="text-sm font-semibold">{task.name}</h4>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status:</span>
                        <Badge
                          variant="outline"
                        >
                          {task.status}
                        </Badge>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Execution Time:
                        </span>
                        <span className="font-medium">
                          {task.executionTime}ms
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Start Time:
                        </span>
                        <span className="font-medium">
                          {new Date(
                            startTime.getTime() + task.startTime,
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">End Time:</span>
                        <span className="font-medium">
                          {new Date(
                            startTime.getTime() + task.endTime,
                          ).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
          </div>
        ))}
      {/* </div> */}
    </div>
  );
};

const FlowExecutionLogs: React.FC = () => {
  const { endpointId } = useParams<{ endpointId: string }>();
  const { flowExecutionLogs, fetchFlowExecutionLogs } = useFlowExecutionLogs({
    endpointId: endpointId,
  });
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    null,
  );
  const [selectedLog, setSelectedLog] = useState<FlowExecutionLog | null>(null);
  const [zoomLevel, setZoomLevel] = useState(100);

  // Set default selection to latest execution
  useEffect(() => {
    if (flowExecutionLogs.length > 0 && !selectedExecutionId) {
      const latestLog = flowExecutionLogs[0]; // Already sorted by newest first
      setSelectedExecutionId(latestLog.executionId);
      setSelectedLog(latestLog);
    }
  }, [flowExecutionLogs, selectedExecutionId]);

  // Update selected log when execution ID changes
  useEffect(() => {
    if (selectedExecutionId) {
      const log = flowExecutionLogs.find(
        (log) => log.executionId === selectedExecutionId,
      );
      setSelectedLog(log || null);
    }
  }, [selectedExecutionId, flowExecutionLogs]);

  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatExecutionId = (executionId: string) => {
    const date = new Date(parseInt(executionId));
    return date.toLocaleTimeString();
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 25, 200));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 25, 50));
  };

  return (
    <div className="flex h-full">
      {/* Left Panel - Execution List */}
      <div
        className="scrollbar-gutter custom-scrollbar h-full w-1/3 overflow-auto border-r border-border"
        style={{ minWidth: "8rem" }}
      >
        <div className="space-y-2 p-2">
          {flowExecutionLogs.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <AlertCircle className="mx-auto mb-2 h-8 w-8" />
              <p>No flow executions yet</p>
              <p className="text-sm">Execute the endpoint to see logs</p>
            </div>
          ) : (
            flowExecutionLogs.map((log) => (
              <div
                key={log.executionId}
                className={cn(
                  "min-w-[5rem] cursor-pointer rounded-md border border-border bg-background px-2 py-1 transition-all duration-200 hover:shadow-sm",
                  selectedExecutionId === log.executionId &&
                    "ring-2 ring-primary",
                )}
                onClick={() => setSelectedExecutionId(log.executionId)}
              >
                <p className="text-sm font-medium">
                  {formatExecutionId(log.executionId)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel - Custom Timeline */}
      <div className="flex-1" style={{ width: "50%" }}>
        {selectedLog ? (
          <div className="flex h-full flex-col">
            {selectedLog.nodeLogs && selectedLog.nodeLogs.length > 0 ? (
              <>
                {/* Timeline Header with Zoom Controls */}
                <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2">
                  <h3 className="text-lg font-semibold">Execution Timeline</h3>
                  {/* <div className="flex items-center gap-2">
                    <button
                      onClick={handleZoomOut}
                      className="flex h-8 w-8 items-center justify-center rounded border border-border hover:bg-muted"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <span className="min-w-[3rem] text-center text-sm font-medium">
                      {zoomLevel}%
                    </span>
                    <button
                      onClick={handleZoomIn}
                      className="flex h-8 w-8 items-center justify-center rounded border border-border hover:bg-muted"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                  </div> */}
                </div>

                {/* Timeline Content */}
                <div className="h-full flex-1 overflow-auto scrollbar-gutter custom-scrollbar">
                  <TimelineChart
                    nodeLogs={selectedLog.nodeLogs}
                    zoomLevel={zoomLevel}
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <AlertCircle className="mx-auto mb-4 h-12 w-12" />
                  <p>No node execution data available</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <AlertCircle className="mx-auto mb-4 h-12 w-12" />
              <p>Select an execution to view timeline</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlowExecutionLogs;
