"use client";

import React, { useRef, useEffect, useState } from "react";
import { LogEntry } from "../lib/custom-server";
import { Info, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LogDisplayProps {
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
}

const LogDisplay: React.FC<LogDisplayProps> = React.memo(
  ({ logs, loading, error }) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [showScrollButton, setShowScrollButton] = useState(false);
    const [updatedLogs, setUpdatedLogs] = useState(logs);
    const isLogsUpdated = updatedLogs.length !== logs.length;

    // Auto-scroll to bottom when component mounts or logs change
    useEffect(() => {
      setUpdatedLogs(logs);
    }, [logs]);

    useEffect(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }, [isLogsUpdated]);

    // Check if user has scrolled up to show/hide scroll button
    const handleScroll = () => {
      if (scrollContainerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px threshold
        setShowScrollButton(!isAtBottom);
      }
    };

    // Scroll to bottom function
    const scrollToBottom = () => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          top: scrollContainerRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    };

    if (error) {
      return (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      );
    }

    return (
      <div className="relative">
        <div
          ref={scrollContainerRef}
          className="h-96 overflow-auto rounded-md border bg-black font-mono text-sm text-green-400"
          style={{ 
            height: "30rem",
            color: "#4ade80"
          }}
          onScroll={handleScroll}
        >
          <div className="p-4">
          {updatedLogs.length === 0 ? (
            <div 
              className="py-8 text-center text-green-400/50"
              style={{ color: "#4ade8080" }}
            >
              <Info className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No logs available</p>
              <p className="text-sm">Start the server to see logs</p>
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="mb-1">
                <span 
                  className="text-gray-500"
                  style={{ color: "#6b7280" }}
                >
                  [{log.timestamp.toLocaleTimeString()}]
                </span>
                <span
                  className={`ml-2 ${
                    log.level === "error"
                      ? "text-red-500"
                      : log.level === "warn"
                        ? "text-yellow-500"
                        : log.level === "info"
                          ? "text-blue-500"
                          : "text-gray-500"
                  }`}
                  style={{
                    color: log.level === "error" 
                      ? "#ef4444" 
                      : log.level === "warn" 
                        ? "#eab308" 
                        : log.level === "info" 
                          ? "#3b82f6" 
                          : "#6b7280"
                  }}
                >
                  [{log.level.toUpperCase()}]
                </span>
                <span 
                  className="ml-2 text-green-400"
                  style={{ color: "#4ade80" }}
                >
                  {log.message}
                </span>
                {log.data && (
                  <div 
                    className="ml-4 mt-1 text-xs text-gray-300"
                    style={{ color: "#d1d5db" }}
                  >
                    <pre className="whitespace-pre-wrap">
                      {typeof log.data === "string"
                        ? log.data
                        : JSON.stringify(log.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
          </div>
        </div>
        
        {/* Scroll to bottom button */}
        {showScrollButton && (
          <Button
          variant="outline"
            onClick={scrollToBottom}
            size="sm"
            className="absolute bottom-4 right-4 h-8 w-8 rounded-full bg-secondary hover:bg-secondary/80 text-white shadow-lg border-border"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  },
);

LogDisplay.displayName = "LogDisplay";

export default LogDisplay;
