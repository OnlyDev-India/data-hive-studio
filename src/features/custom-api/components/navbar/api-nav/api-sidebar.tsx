"use client";

import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import {
  initAPIDetails,
  getAPIsForConnection
} from "@/features/custom-api/utils/data-thunk-func";
import { getCurrentConnectionDetails } from "@/lib/actions/database-backup";
import {
  APIHeader,
  EndpointsList
} from "../../index";
import { GroupIcon } from "lucide-react";

const APISidebar: React.FC = () => {
  const dispatch = useDispatch();
  const { currentAPI, loading, error } = useSelector((state: RootState) => state.api);
  
  const [currentConnection, setCurrentConnection] = useState<any>(null);

  const connectionId = currentConnection?.id;
  const connectionName = currentConnection?.name;


  useEffect(() => {
    // Get current connection from connection manager
    const fetchCurrentConnection = async () => {
      const connectionDetails = await getCurrentConnectionDetails();
      setCurrentConnection(connectionDetails);
    };

    fetchCurrentConnection();
  }, []);

  useEffect(() => {
    if (connectionId) {
      dispatch(initAPIDetails({connectionId}) as any);
      dispatch(getAPIsForConnection(connectionId) as any);
    }
  }, [connectionId, dispatch]);


  const totalGroups = currentAPI?.groups?.length || 0;
  const totalEndpoints = currentAPI?.endpoints?.length || 0;

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <APIHeader
        connectionName={connectionName || ""}
        totalGroups={totalGroups}
        totalEndpoints={totalEndpoints}
        apiId={currentAPI?.id || ""}
      />

      {/* API List */}
      <div className="flex-1 overflow-auto p-2">
        {loading === "initializing" || loading === "fetching" ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-sm text-muted-foreground">{loading === "initializing" ? "Initializing APIs..." : "Fetching APIs..."}</div>
          </div>
        ) : totalGroups === 0 && currentAPI?.endpoints?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <GroupIcon className="h-8 w-8 text-muted-foreground mb-2" />
            <div className="text-sm text-muted-foreground mb-1">No endpoints yet</div>
            <div className="text-xs text-muted-foreground">
              Create your first endpoint to get started
            </div>
          </div>
        ) : currentAPI && (
            <EndpointsList
            groups={currentAPI?.groups || []}
            currentAPI={currentAPI}
            apiId={currentAPI?.id || ""}
          />
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-2 border-t">
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        </div>
      )}
    </div>
  );
};

export default APISidebar;