"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Play,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FlowExecutionLog } from "@/features/custom-api/lib/custom-server";
import { useFlowExecutionLogs } from "@/features/custom-api/hooks/use-flow-execution-logs";
import { useParams } from "next/navigation";

const FlowExecutionLogs: React.FC = () => {
  const { endpointId } = useParams<{ endpointId: string }>();
  const { flowExecutionLogs, fetchFlowExecutionLogs } = useFlowExecutionLogs({
    endpointId: endpointId,
  });
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    null,
  );
  const [selectedLog, setSelectedLog] = useState<FlowExecutionLog | null>(null);

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

  const getStatusIcon = (status: FlowExecutionLog["status"]) => {
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

  const getStatusColor = (status: FlowExecutionLog["status"]) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "error":
        return "bg-red-100 text-red-800 border-red-200";
      case "executing":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "pending":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatExecutionId = (executionId: string) => {
    const date = new Date(parseInt(executionId));
    return date.toLocaleTimeString();
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

      {/* Right Panel - Execution Details */}
      <div className="flex-1">
        {selectedLog ? (
          <div className="scrollbar-gutter custom-scrollbar flex h-full flex-col overflow-auto">
            <div className="flex-1">
              <div className="space-y-6 p-4">
                {/* Request Data */}
                {selectedLog.requestData && (
                  <div className="rounded-md border border-border bg-background">
                    <div className="p-3">
                      <div className="space-y-3">
                        <div>
                          <Badge variant="outline">
                            {selectedLog.requestData.method}
                          </Badge>
                          <code className="rounded bg-muted px-2 py-1 text-sm">
                            {selectedLog.requestData.path}
                          </code>
                        </div>
                        {selectedLog.requestData.params &&
                          Object.keys(selectedLog.requestData.params).length >
                            0 && (
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Params
                              </p>
                              <pre className="overflow-auto rounded bg-secondary p-2 text-xs">
                                {JSON.stringify(
                                  selectedLog.requestData.params,
                                  null,
                                  2,
                                )}
                              </pre>
                            </div>
                          )}
                        {selectedLog.requestData.query &&
                          Object.keys(selectedLog.requestData.query).length >
                            0 && (
                            <div>
                              <p className="text-sm font-medium text-muted-foreground">
                                Query
                              </p>
                              <pre className="overflow-auto rounded bg-secondary p-2 text-xs">
                                {JSON.stringify(
                                  selectedLog.requestData.query,
                                  null,
                                  2,
                                )}
                              </pre>
                            </div>
                          )}
                        {selectedLog.requestData.body && (
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Body
                            </p>
                            <pre className="overflow-auto rounded bg-muted p-2 text-xs">
                              {JSON.stringify(
                                selectedLog.requestData.body,
                                null,
                                2,
                              )}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Response Data */}
                {selectedLog.responseData && (
                  <div className="rounded-md border border-border bg-background">
                    <div className="p-3">
                      <pre className="overflow-auto rounded bg-secondary p-2 text-xs">
                        {JSON.stringify(selectedLog.responseData, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Node Logs */}
                {selectedLog.nodeLogs && selectedLog.nodeLogs.length > 0 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">
                      Node Execution Flow
                    </h3>
                    <div className="relative">
                      {/* Flow Container */}
                      <div className="">
                        {selectedLog.nodeLogs.map((nodeLog, index) => (
                          <div
                            key={index}
                            className="relative flex flex-col items-center"
                          >
                            {/* Node Form */}
                            <div
                              className={cn(
                                "relative mx-auto w-full max-w-md rounded-lg border-2 p-4 transition-all duration-200",
                                nodeLog.status === "completed" &&
                                  "border-green-200 bg-green-50 shadow-green-100",
                                nodeLog.status === "error" &&
                                  "border-red-200 bg-red-50 shadow-red-100",
                                nodeLog.status === "executing" &&
                                  "border-blue-200 bg-blue-50 shadow-blue-100",
                                nodeLog.status === "pending" &&
                                  "border-yellow-200 bg-yellow-50 shadow-yellow-100",
                              )}
                            >
                              {/* Connection Points */}
                              {index > 0 && (
                                <div
                                  className="absolute -top-0 left-1/2 h-4 w-4 -translate-x-1/2 transform rounded-full border-2 border-gray-400 bg-background"
                                  style={{ top: "-0.5rem" }}
                                ></div>
                              )}
                              {index <
                                (selectedLog.nodeLogs?.length || 0) - 1 && (
                                <div className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 transform rounded-full border-2 border-gray-400 bg-background"></div>
                              )}

                              {/* Node Header */}
                              <div className="mb-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    {getStatusIcon(nodeLog.status)}
                                    <h4 className="font-medium text-foreground">
                                      {nodeLog.nodeName}
                                    </h4>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-xs",
                                      getStatusColor(nodeLog.status),
                                    )}
                                  >
                                    {nodeLog.status}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  {nodeLog.executionTime && (
                                    <span>{nodeLog.executionTime}ms</span>
                                  )}
                                  <span>
                                    {new Date(
                                      nodeLog.timestamp,
                                    ).toLocaleTimeString()}
                                  </span>
                                </div>
                              </div>

                              {/* Node Content */}
                              <div className="space-y-3">
                                {/* Error Display */}
                                {nodeLog.error && (
                                  <div className="rounded-md bg-red-100 p-3">
                                    <p className="text-sm font-medium text-red-800">
                                      Error:
                                    </p>
                                    <p className="text-sm text-red-700">
                                      {nodeLog.error}
                                    </p>
                                  </div>
                                )}

                                {/* Input Display */}
                                {nodeLog.input && (
                                  <div className="space-y-2">
                                    <details className="group">
                                      <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                                        View Input
                                      </summary>
                                      <div className="mt-2 rounded-md bg-muted p-3">
                                        <pre className="overflow-auto text-xs">
                                          {JSON.stringify(
                                            nodeLog.input,
                                            null,
                                            2,
                                          )}
                                        </pre>
                                      </div>
                                    </details>
                                  </div>
                                )}

                                {/* Output Display */}
                                {nodeLog.output && (
                                  <div className="space-y-2">
                                    <details className="group">
                                      <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                                        View Output
                                      </summary>
                                      <div className="mt-2 rounded-md bg-muted p-3">
                                        <pre className="overflow-auto text-xs">
                                          {JSON.stringify(
                                            nodeLog.output,
                                            null,
                                            2,
                                          )}
                                        </pre>
                                      </div>
                                    </details>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Connection Arrow */}
                            {index <
                              (selectedLog.nodeLogs?.length || 0) - 1 && (
                              <div className="flex w-full flex-col items-center">
                                {/* Vertical Line */}
                                <div className="h-16 w-[1px] bg-border"></div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Details */}
                {selectedLog.error && (
                  <Card className="border-red-200">
                    <CardHeader>
                      <CardTitle className="text-base text-red-600">
                        Error
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-red-600">
                        {selectedLog.error}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <AlertCircle className="mx-auto mb-4 h-12 w-12" />
              <p>Select an execution to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FlowExecutionLogs;
