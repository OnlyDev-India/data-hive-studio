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
import {
  getConnectionStatus,
  forceReconnect,
  getConnectionState,
  connectDb,
} from "@/lib/actions/fetch-data";
import { usePathname } from "next/navigation";

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
  const [autoReconnectAttempts, setAutoReconnectAttempts] = useState(0);
  const [isAutoReconnecting, setIsAutoReconnecting] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true); // Track first load
  const pathname = usePathname();
  const isConnectedPage = pathname.startsWith("/app");

  // Auto-reconnection logic
  const attemptAutoReconnect = async () => {
    if (isConnectedPage) return;
    if (isAutoReconnecting || autoReconnectAttempts >= 3) return;

    setIsAutoReconnecting(true);
    setAutoReconnectAttempts((prev) => prev + 1);

    try {
      const result = await connectDb();

      if (result.response.success) {
        setAutoReconnectAttempts(0);
        await fetchConnectionState();
      } else {
        throw new Error(result.response.error || "Reconnection failed");
      }
    } catch (error) {
      console.error("Auto-reconnection failed:", error);

      if (autoReconnectAttempts < 3) {
        // Schedule next attempt with exponential backoff
        setTimeout(
          () => {
            if (!connectionState?.isConnected) {
              attemptAutoReconnect();
            }
          },
          (autoReconnectAttempts + 1) * 5000,
        );
      }
    } finally {
      setIsAutoReconnecting(false);
    }
  };

  useEffect(() => {
    // Listen for connection events
    const handleReconnected = (event: CustomEvent) => {
      const { connectionId: reconnectedId } = event.detail;
      if (!connectionId || connectionId === reconnectedId) {
        toast.success("Database connection restored!", {
          description: "Auto-reconnection successful",
          duration: 4000,
        });
        setAutoReconnectAttempts(0);
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

    // Initial fetch with delay to allow app to initialize
    const initialTimer = setTimeout(() => {
      fetchConnectionState();
      setIsFirstLoad(false); // Mark first load as complete
    }, 2000); // Wait 2 seconds before first check

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
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [connectionId]);

  const fetchConnectionState = async () => {
    try {
      const data = await getConnectionStatus();
      if (data.success && data.state) {
        setConnectionState({
          isConnected: data.state.isConnected,
          lastHealthCheck: new Date(data.state.lastHealthCheck),
          connectionAttempts: data.state.connectionAttempts,
          lastError: data.state.lastError,
          isReconnecting: data.state.isReconnecting,
        });

        // Reset auto-reconnect attempts if connection is successful
        if (data.state.isConnected) {
          setAutoReconnectAttempts(0);
        }
      } else {
        // If no connection found, show disconnected state
        setConnectionState({
          isConnected: false,
          lastHealthCheck: new Date(),
          connectionAttempts: 0,
          lastError: "No active connection",
          isReconnecting: false,
        });

        // Trigger automatic reconnection if not already attempting
        if (!isAutoReconnecting && autoReconnectAttempts < 3) {
          setTimeout(() => attemptAutoReconnect(), 2000); // Wait 2 seconds before auto-reconnect
        }
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

      // Trigger automatic reconnection on error if not already attempting
      if (!isAutoReconnecting && autoReconnectAttempts < 3) {
        setTimeout(() => attemptAutoReconnect(), 3000); // Wait 3 seconds before auto-reconnect
      }
    }
  };

  const handleForceReconnect = async () => {
    setIsForceReconnecting(true);
    try {
      toast.info("Attempting to reconnect...", {
        description: "Forcing database reconnection",
      });
      const data = await forceReconnect(connectionId);
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
    if (isFirstLoad) return <Clock className="h-3 w-3" />;
    if (!connectionState) return <Clock className="h-3 w-3" />;

    if (
      connectionState.isReconnecting ||
      isForceReconnecting ||
      isAutoReconnecting
    ) {
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
    if (isFirstLoad) return "Checking...";
    if (!connectionState) return "Checking...";

    if (connectionState.isReconnecting || isForceReconnecting) {
      return "Reconnecting...";
    }

    if (isAutoReconnecting) {
      return `Auto-reconnecting (${autoReconnectAttempts}/3)`;
    }

    if (connectionState.isConnected) {
      return "Connected";
    }

    if (connectionState.connectionAttempts > 0) {
      return `Reconnecting (${connectionState.connectionAttempts}/3)`;
    }

    if (autoReconnectAttempts > 0) {
      return `Auto-reconnect failed (${autoReconnectAttempts}/3)`;
    }

    return "Disconnected";
  };

  const getStatusColor = () => {
    if (isFirstLoad) return "secondary";
    if (!connectionState) return "secondary";

    if (
      connectionState.isReconnecting ||
      isForceReconnecting ||
      isAutoReconnecting
    ) {
      return "secondary";
    }

    if (connectionState.isConnected) {
      return "default";
    }

    if (connectionState.connectionAttempts > 0 || autoReconnectAttempts > 0) {
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
              "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-xs transition-colors hover:bg-popover",
              className,
            )}
          >
            <div
              className={cn("flex items-center justify-center", {
                "text-green-500":
                  connectionState?.isConnected &&
                  !connectionState?.isReconnecting &&
                  !isFirstLoad,
                "text-yellow-500":
                  connectionState?.isReconnecting ||
                  isForceReconnecting ||
                  isAutoReconnecting,
                "text-red-500":
                  !connectionState?.isConnected &&
                  !connectionState?.isReconnecting &&
                  !isFirstLoad,
                "text-muted-foreground": !connectionState || isFirstLoad,
              })}
            >
              {getStatusIcon()}
            </div>
            <span className="min-w-0 truncate text-foreground">
              {getStatusText()}
            </span>
            {(connectionState?.isReconnecting ||
              isForceReconnecting ||
              isAutoReconnecting ||
              isFirstLoad) && (
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
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status:</span>
              <div className="flex items-center gap-2">
                <div
                  className={cn("h-2 w-2 rounded-full", {
                    "bg-green-500":
                      connectionState?.isConnected &&
                      !connectionState?.isReconnecting &&
                      !isAutoReconnecting &&
                      !isFirstLoad,
                    "bg-yellow-500":
                      connectionState?.isReconnecting ||
                      isForceReconnecting ||
                      isAutoReconnecting,
                    "bg-red-500":
                      !connectionState?.isConnected &&
                      !connectionState?.isReconnecting &&
                      !isAutoReconnecting &&
                      !isFirstLoad,
                    "bg-gray-500": !connectionState || isFirstLoad,
                  })}
                />
                <span className="text-sm">{getStatusText()}</span>
              </div>
            </div>

            {connectionState && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Last Health Check:
                  </span>
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

                {autoReconnectAttempts > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Auto-reconnect Attempts:
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {autoReconnectAttempts}/3
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
                disabled={
                  isForceReconnecting || connectionState?.isReconnecting
                }
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

            <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
              <p>• Health checks every 10 seconds</p>
              <p>• Auto-reconnect with exponential backoff</p>
              <p>• Maximum 3 auto-reconnect attempts</p>
              <p>• Manual force reconnect available</p>
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

            {autoReconnectAttempts > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Auto-reconnect Attempts:
                </span>
                <span className="text-sm text-muted-foreground">
                  {autoReconnectAttempts}/3
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
          <p>• Health checks every 10 seconds</p>
          <p>• Auto-reconnect with exponential backoff</p>
          <p>• Maximum 3 auto-reconnect attempts</p>
          <p>• Manual force reconnect available</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default ConnectionStatus;
