"use client";
import {
  initAppData,
  setConnectionLoading,
  setCurrentConnection,
} from "@/redux/features/appdb";
import { ConnectionDetailsType, ConnectionsType } from "@/types/db.type";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "../ui/button";
import ConnectionMenu from "../context-menu/connection-menu";
import { testConnection } from "@/lib/actions/fetch-data";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Input } from "../ui/input";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { RotateCwIcon } from "lucide-react";
import { parseConnectionString } from "@/lib/helper/connection-details";

const ConnectionSidebar = () => {
  const [searchQuery, setSearchQuery] = useState("");

  const {
    connections,
    loading,
  }: {
    connections: ConnectionsType[];
    loading: boolean;
  } = useSelector((state: any) => state.appDB);

  const dispatch = useDispatch();
  const router = useRouter();

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
      host: config.host || '',
      port: config.port || 5432,
      username: config.user || '',
      password: config.password || '',
      database: config.database || '',
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
    dispatch(initAppData() as any);
  };

  return (
    <div className="scrollable-container-gutter my-2 h-[calc(100%-1rem)] overflow-auto rounded-lg bg-secondary py-4 pl-4">
      <div className="flex flex-col gap-2">
        <Button
          variant={"secondary"}
          className="h-7 w-full bg-popover/40 backdrop-blur-md text-sm font-medium transition-all hover:bg-popover/60"
          onClick={handleNewConnection}
        >
          + New Connection
        </Button>
        <div>
          <Input
            placeholder="Search connections..."
            className="h-7 border border-popover bg-secondary !text-xs focus-visible:ring-0"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="group flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">Connections</span>
              <span className="rounded-full bg-popover px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {connections?.length || 0}
              </span>
            </div>
            <div>
              <Button
                variant={"ghost"}
                size={"icon"}
                onClick={handleRefreshConnections}
                className="invisible h-4 w-4 text-muted-foreground hover:text-foreground group-hover:visible [&_svg]:size-3.5"
              >
                <RotateCwIcon className={cn({ "animate-spin": loading })} />
              </Button>
            </div>
          </div>
          {connections
            ?.filter((connection) =>
              connection.name.toLowerCase().includes(searchQuery.toLowerCase()),
            )
            .map((connection, index) => {
              return (
                <ConnectionMenu connection={connection} key={index}>
                  <Button
                    variant={"ghost"}
                    className="flex h-14 w-full justify-between rounded-lg border-l-4 bg-popover/40 backdrop-blur-md px-4 py-2 transition-all hover:bg-popover/60"
                    style={{ borderLeftColor: connection.color }}
                    disabled={loading}
                    onClick={() => handleCurrentConnection(connection)}
                    onDoubleClick={() =>
                      handleCurrentConnectionConnect(connection)
                    }
                  >
                    <div className="flex w-[70%] flex-col items-start gap-1 text-start">
                      <span className="w-full truncate text-sm font-medium">
                        {connection.name}
                      </span>
                      <span className="w-full flex-1 truncate text-[11px] text-muted-foreground/80">
                        {connection.connection_string}
                      </span>
                    </div>
                    <div>
                      <span className="rounded-full bg-background/80 px-2 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur-sm">
                        {connection.connection_type || "sqlite"}
                      </span>
                    </div>
                  </Button>
                </ConnectionMenu>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default ConnectionSidebar;
