"use client";
import {
  initAppData,
  setConnectionLoading,
  setCurrentConnection,
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
import { RotateCwIcon } from "lucide-react";

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
    connection: ConnectionsType
  ) => {
    dispatch(setConnectionLoading(true));
    const response = await testConnection({
      connectionString: connection.connection_string,
      isConnect: true,
      dbType: connection.connection_type as any,
    });
    if (response.success) {
      router.push("/app/editor");
    } else {
      toast.error("Failed to connect");
      dispatch(setConnectionLoading(false));
    }
  };

  const handleNewConnection = () => {
    dispatch(setCurrentConnection(null));
  };

  const handleRefreshConnections=()=>{
    dispatch(initAppData() as any);
  }

  return (
    <div className="h-full overflow-auto scrollable-container-gutter pl-4 py-4">
      <div className="flex flex-col gap-2">
        <Button
          variant={"secondary"}
          className="w-full h-7 bg-popover text-xs font-bold"
          onClick={handleNewConnection}
        >
          + New Connection
        </Button>
        <div>
          <Input
            placeholder="Search connections..."
            className="bg-secondary focus-visible:ring-0 border border-popover !text-xs h-7"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between group">
            <div className="flex items-center gap-2">
              <span className="text-sm">Connections</span>
              <span className="text-[10px] text-muted-foreground rounded-full bg-popover py-0.5 px-1.5">
                {connections?.length || 0}
              </span>
            </div>
            <div>
              <Button
                variant={"ghost"}
                size={"icon"}
                onClick={handleRefreshConnections}
                className="h-4 w-4 group-hover:visible invisible text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
              >
                <RotateCwIcon className={cn({ "animate-spin": loading })}/>
              </Button>
            </div>
          </div>
          {connections
            ?.filter((connection) =>
              connection.name.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .map((connection, index) => {
              return (
                <ConnectionMenu connection={connection} key={index}>
                  <Button
                    variant={"ghost"}
                    className="w-full px-4 py-2 bg-popover rounded-md border-l-4 flex justify-between h-12"
                    style={{ borderLeftColor: connection.color }}
                    disabled={loading}
                    onClick={() => handleCurrentConnection(connection)}
                    onDoubleClick={() =>
                      handleCurrentConnectionConnect(connection)
                    }
                  >
                    <div className="flex flex-col items-start w-[70%] text-start">
                      <span className="text-xs w-full truncate">
                        {connection.name}
                      </span>
                      <span className="flex-1 w-full text-muted-foreground text-[10px] truncate">
                        {connection.connection_string}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-[10px] bg-background p-1 px-1.5 rounded-full">
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
