"use client";
import {
  initConnectedConnection,
  setConnectionLoading,
  setCurrentConnection
} from "@/redux/features/appdb";
import { ConnectionsType } from "@/types/db.type";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "../ui/button";
import ConnectionMenu from "../context-menu/connection-menu";
import { testConnection } from "@/lib/actions/fetch-data";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Input } from "../ui/input";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { RotateCwIcon, Plus, Search } from "lucide-react";
import { parseConnectionString } from "@/lib/helper/connection-details";
import { Badge } from "@/components/ui/badge";
import { useAppData } from "@/hooks/useAppData";
import { AppDispatch, RootState } from "@/redux/store";

const ConnectionSidebar = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const { connections, loading } = useSelector(
    (state: RootState) => state.appDB,
  );

  const dispatch = useDispatch<AppDispatch>();
  const router = useRouter();
  const { updateConnection } = useAppData();

  const handleCurrentConnection = async (connection: ConnectionsType) => {
    dispatch(setCurrentConnection(connection));
  };

  const handleCurrentConnectionConnect = async (
    connection: ConnectionsType,
  ) => {
    dispatch(setConnectionLoading(true));
    const config = parseConnectionString(connection.connection_string);
    if (config.error) {
      toast.error(config.error);
      dispatch(setConnectionLoading(false));
      return;
    }

    const dbConfig = {
      id: connection.id,
      name: connection.name,
      connection_type: connection.connection_type,
      host: config.host || "",
      port: config.port || 5432,
      username: config.user || "",
      password: config.password || "",
      database: config.database || "",
      connection_string: connection.connection_string,
      save_password: connection.save_password,
      color: connection.color,
      ssl: config.ssl ? { rejectUnauthorized: false } : false,
    };
    const response = await testConnection({
      connectionDetails: dbConfig,
      isConnect: true,
      dbType: connection.connection_type as any,
    });
    if (response.success) {
      await updateConnection({
        ...connection,
        is_current: true,
      });
      router.push("/app/editor");
    } else {
      toast.error(response.error || "Failed to connect");
      dispatch(setConnectionLoading(false));
    }
  };

  const handleNewConnection = () => {
    dispatch(setCurrentConnection(null));
  };

  const handleRefreshConnections = () => {
    dispatch(initConnectedConnection());
  };

  return (
    <div className="my-2 flex h-[calc(100%-1rem)] flex-col gap-4 overflow-auto rounded-lg bg-secondary pt-4">
      <div className="space-y-4 px-2">
        <Button
          variant={"outline"}
          className="h-8 w-full border-dashed border-border/50 bg-transparent text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-white/5"
          onClick={handleNewConnection}
        >
          <Plus className="mr-2 h-3 w-3" /> New Connection
        </Button>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search connections/apis..."
            className="h-8 rounded-md border-border/50 bg-white/5 pl-8 !text-xs ring-offset-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="relative h-full space-y-2 overflow-y-auto px-2 pb-1">
        <div className="group sticky top-0 z-10 flex items-center justify-between bg-secondary">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Connections
            </h3>
            <Badge variant={"secondary"} className="rounded-full">
              {connections?.length || 0}
            </Badge>
          </div>
          <Button
            variant={"ghost"}
            size={"icon"}
            onClick={handleRefreshConnections}
            className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          >
            <RotateCwIcon
              className={cn("h-3.5 w-3.5", { "animate-spin": loading==='initial' })}
            />
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          {connections
            ?.filter((connection) =>
              connection.name.toLowerCase().includes(searchQuery.toLowerCase()),
            )
            .map((connection, index) => (
              <ConnectionMenu connection={connection} key={index}>
                <div
                  className="group flex cursor-pointer items-center justify-between rounded-md bg-white/5 px-2 py-1.5 transition-colors hover:bg-white/10"
                  onClick={() => handleCurrentConnection(connection)}
                  onDoubleClick={() =>
                    handleCurrentConnectionConnect(connection)
                  }
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-1.5 w-1.5 rounded-full"
                      style={{
                        backgroundColor: connection.color || "transparent",
                      }}
                    />
                    <div className="flex flex-col">
                      <span className="truncate text-xs font-medium text-foreground">
                        {connection.name}
                      </span>
                      <span className="truncate text-[11px] text-muted-foreground/60">
                        {connection.connection_type || "N/A"}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px] opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCurrentConnectionConnect(connection);
                    }}
                  >
                    Connect
                  </Button>
                </div>
              </ConnectionMenu>
            ))}
        </div>
      </div>
    </div>
  );
};

export default ConnectionSidebar;
