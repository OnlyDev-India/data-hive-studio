import { NextRequest, NextResponse } from "next/server";
import { EnhancedConnectionManager } from "@/lib/databases/connection-manager";
import { cookies } from "next/headers";
import { ConnectionDetailsType } from "@/types/db.type";

export async function GET(request: NextRequest) {
  try {
    const connectionManager = EnhancedConnectionManager.getInstance();
    
    // Get connection ID from cookies
    const cookie = cookies();
    const connectionUrl = cookie.get("currentConnection");
    
    if (!connectionUrl?.value) {
      return NextResponse.json({
        success: false,
        error: "No active connection found"
      }, { status: 404 });
    }

    const connectionDetails: ConnectionDetailsType = JSON.parse(connectionUrl.value);
    const connectionId = connectionDetails.id;
    
    // Get connection state
    const connectionState = connectionManager.getConnectionState(connectionId);
    const isHealthy = connectionManager.isConnectionHealthy(connectionId);
    const lastError = connectionManager.getLastError(connectionId);
    
    if (!connectionState) {
      return NextResponse.json({
        success: false,
        error: "Connection state not found"
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      connectionId,
      state: {
        isConnected: connectionState.isConnected,
        lastHealthCheck: connectionState.lastHealthCheck,
        connectionAttempts: connectionState.connectionAttempts,
        lastError: connectionState.lastError,
        isReconnecting: connectionState.isReconnecting,
        isHealthy,
      }
    });
  } catch (error) {
    console.error("Error getting connection status:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, connectionId } = body;
    
    if (!connectionId) {
      return NextResponse.json({
        success: false,
        error: "Connection ID is required"
      }, { status: 400 });
    }

    const connectionManager = EnhancedConnectionManager.getInstance();
    
    switch (action) {
      case "forceReconnect":
        const success = await connectionManager.forceReconnect(connectionId);
        return NextResponse.json({
          success,
          message: success ? "Reconnection initiated" : "Reconnection failed"
        });
        
      case "getState":
        const state = connectionManager.getConnectionState(connectionId);
        return NextResponse.json({
          success: true,
          state
        });
        
      default:
        return NextResponse.json({
          success: false,
          error: "Invalid action"
        }, { status: 400 });
    }
  } catch (error) {
    console.error("Error handling connection action:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 500 });
  }
} 