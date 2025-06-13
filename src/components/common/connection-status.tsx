"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ConnectionState {
  isConnected: boolean;
  lastHealthCheck: Date;
  connectionAttempts: number;
  lastError: string | null;
  isReconnecting: boolean;
}

interface ConnectionStatusProps {
  connectionId?: string;
  showDetails?: boolean;
  className?: string;
}

export function ConnectionStatus({
  connectionId,
  showDetails = false,
  className,
}: ConnectionStatusProps) {
  const [connectionState, setConnectionState] =
    useState<ConnectionState | null>(null);
  const [isForceReconnecting, setIsForceReconnecting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    // Listen for connection events
    const handleReconnected = (event: CustomEvent) => {
      const { connectionId: reconnectedId } = event.detail;
      if (!connectionId || connectionId === reconnectedId) {
        toast.success("Database connection restored!", {
          description: "Auto-reconnection successful",
          duration: 4000,
        });
        fetchConnectionState();
      }
    };

    const handleConnectionLost = (event: CustomEvent) => {
      const { connectionId: lostConnectionId } = event.detail;
      if (!connectionId || connectionId === lostConnectionId) {
        toast.error("Database connection lost", {
          description:
            "Maximum reconnection attempts reached. Please check your connection and try again.",
          duration: 8000,
        });
        fetchConnectionState();
      }
    };

    window.addEventListener(
      "database-reconnected",
      handleReconnected as EventListener,
    );
    window.addEventListener(
      "database-connection-lost",
      handleConnectionLost as EventListener,
    );

    // Initial fetch
    fetchConnectionState();

    // Set up periodic state updates
    const interval = setInterval(fetchConnectionState, 10000); // Update every 10 seconds

    return () => {
      window.removeEventListener(
        "database-reconnected",
        handleReconnected as EventListener,
      );
      window.removeEventListener(
        "database-connection-lost",
        handleConnectionLost as EventListener,
      );
      clearInterval(interval);
    };
  }, [connectionId]);

  const fetchConnectionState = async () => {
    try {
      const response = await fetch("/api/connection/status");
      const data = await response.json();

      if (data.success) {
        setConnectionState({
          isConnected: data.state.isConnected,
          lastHealthCheck: new Date(data.state.lastHealthCheck),
          connectionAttempts: data.state.connectionAttempts,
          lastError: data.state.lastError,
          isReconnecting: data.state.isReconnecting,
        });
      } else {
        // If no connection found, show disconnected state
        setConnectionState({
          isConnected: false,
          lastHealthCheck: new Date(),
          connectionAttempts: 0,
          lastError: "No active connection",
          isReconnecting: false,
        });
      }
    } catch (error) {
      console.error("Failed to fetch connection state:", error);
      setConnectionState({
        isConnected: false,
        lastHealthCheck: new Date(),
        connectionAttempts: 0,
        lastError: "Failed to check connection status",
        isReconnecting: false,
      });
    }
  };

  const handleForceReconnect = async () => {
    setIsForceReconnecting(true);
    try {
      toast.info("Attempting to reconnect...", {
        description: "Forcing database reconnection",
      });

      const response = await fetch("/api/connection/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "forceReconnect",
          connectionId: connectionId || "current",
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success("Reconnection successful!");
      } else {
        toast.error("Reconnection failed", {
          description: data.error || "Unknown error",
        });
      }

      await fetchConnectionState();
    } catch (error) {
      toast.error("Reconnection failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsForceReconnecting(false);
    }
  };

  const getStatusIcon = () => {
    if (!connectionState) return <Clock className="h-3 w-3" />;

    if (connectionState.isReconnecting || isForceReconnecting) {
      return <RefreshCw className="h-3 w-3 animate-spin" />;
    }

    if (connectionState.isConnected) {
      return <Wifi className="h-3 w-3" />;
    }

    if (connectionState.lastError) {
      return <AlertTriangle className="h-3 w-3" />;
    }

    return <WifiOff className="h-3 w-3" />;
  };

  const getStatusText = () => {
    if (!connectionState) return "Checking...";

    if (connectionState.isReconnecting || isForceReconnecting) {
      return "Reconnecting...";
    }

    if (connectionState.isConnected) {
      return "Connected";
    }

    if (connectionState.connectionAttempts > 0) {
      return `Reconnecting (${connectionState.connectionAttempts}/3)`;
    }

    return "Disconnected";
  };

  const getStatusColor = () => {
    if (!connectionState) return "secondary";

    if (connectionState.isReconnecting || isForceReconnecting) {
      return "secondary";
    }

    if (connectionState.isConnected) {
      return "default";
    }

    if (connectionState.connectionAttempts > 0) {
      return "secondary";
    }

    return "destructive";
  };

  const formatLastHealthCheck = () => {
    if (!connectionState?.lastHealthCheck) return "Unknown";

    const now = new Date();
    const diff = now.getTime() - connectionState.lastHealthCheck.getTime();
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) {
      return `${seconds}s ago`;
    } else if (seconds < 3600) {
      return `${Math.floor(seconds / 60)}m ago`;
    } else {
      return `${Math.floor(seconds / 3600)}h ago`;
    }
  };

  if (!showDetails) {
    return (
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild>
          <div
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md border bg-border/40 px-3 py-1 text-xs transition-colors hover:bg-border/60",
              className,
            )}
          >
            <div
              className={cn("flex items-center justify-center", {
                "text-green-500":
                  connectionState?.isConnected &&
                  !connectionState?.isReconnecting,
                "text-yellow-500":
                  connectionState?.isReconnecting || isForceReconnecting,
                "text-red-500":
                  !connectionState?.isConnected &&
                  !connectionState?.isReconnecting,
                "text-muted-foreground": !connectionState,
              })}
            >
              {getStatusIcon()}
            </div>
            <span className="min-w-0 truncate text-foreground">
              {getStatusText()}
            </span>
            {(connectionState?.isReconnecting || isForceReconnecting) && (
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
          </div>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {getStatusIcon()}
              Database Connection
            </DialogTitle>
            <DialogDescription>
              Auto-reconnection enabled with health monitoring
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between ">
              <span className="text-sm font-medium">Status:</span>
              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  {
                    "bg-green-500": connectionState?.isConnected && !connectionState?.isReconnecting,
                    "bg-yellow-500": connectionState?.isReconnecting || isForceReconnecting,
                    "bg-red-500": !connectionState?.isConnected && !connectionState?.isReconnecting,
                    "bg-gray-500": !connectionState,
                  }
                )} />
                <span className="text-sm">{getStatusText()}</span>
              </div>
            </div>
            
            {connectionState && (
              <>
                <div className="flex items-center justify-between ">
                  <span className="text-sm font-medium">Last Health Check:</span>
                  <span className="text-sm text-muted-foreground">
                    {formatLastHealthCheck()}
                  </span>
                </div>
                
                {connectionState.connectionAttempts > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Retry Attempts:</span>
                    <span className="text-sm text-muted-foreground">
                      {connectionState.connectionAttempts}/3
                    </span>
                  </div>
                )}
                
                {connectionState.lastError && (
                  <div className="space-y-1">
                    <span className="text-sm font-medium text-destructive">Last Error:</span>
                    <p className="text-sm text-muted-foreground bg-destructive/10 p-2 rounded">
                      {connectionState.lastError}
                    </p>
                  </div>
                )}
              </>
            )}
            
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleForceReconnect}
                disabled={isForceReconnecting || connectionState?.isReconnecting}
                className="flex-1"
              >
                {isForceReconnecting ? (
                  <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <Zap className="h-3 w-3 mr-1" />
                )}
                Force Reconnect
              </Button>
            </div>
            
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>• Health checks every 30 seconds</p>
              <p>• Auto-reconnect with exponential backoff</p>
              <p>• Maximum 3 retry attempts</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          {getStatusIcon()}
          Database Connection
        </CardTitle>
        <CardDescription>
          Auto-reconnection enabled with health monitoring
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Status:</span>
          <Badge variant={getStatusColor() as any}>{getStatusText()}</Badge>
        </div>

        {connectionState && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Last Health Check:</span>
              <span className="text-sm text-muted-foreground">
                {formatLastHealthCheck()}
              </span>
            </div>

            {connectionState.connectionAttempts > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Retry Attempts:</span>
                <span className="text-sm text-muted-foreground">
                  {connectionState.connectionAttempts}/3
                </span>
              </div>
            )}

            {connectionState.lastError && (
              <div className="space-y-1">
                <span className="text-sm font-medium text-destructive">
                  Last Error:
                </span>
                <p className="rounded bg-destructive/10 p-2 text-sm text-muted-foreground">
                  {connectionState.lastError}
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleForceReconnect}
            disabled={isForceReconnecting || connectionState?.isReconnecting}
            className="flex-1"
          >
            {isForceReconnecting ? (
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Zap className="mr-1 h-3 w-3" />
            )}
            Force Reconnect
          </Button>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>• Health checks every 30 seconds</p>
          <p>• Auto-reconnect with exponential backoff</p>
          <p>• Maximum 3 retry attempts</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default ConnectionStatus;
