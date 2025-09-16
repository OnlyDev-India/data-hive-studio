"use client";

import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { getCurrentConnectionDetails } from "@/lib/actions/database-backup";
import { APIHeader, CreateEndpointDialog, EndpointsList } from "../../index";
import { GroupIcon, Wrench, Clock } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CustomTabList,
  CustomTabsContent,
} from "@/components/common/custom-tab";
import { Tabs } from "@/components/ui/tabs";
import { API_SIDEBAR_NAVS } from "@/features/custom-api/config/navs";
const APISidebar: React.FC = () => {
  const { currentAPI, loading, error } = useSelector(
    (state: RootState) => state.api,
  );
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const apiSidebarTab = searchParams.get("apiSidebarTab");
  const [activeTab, setActiveTab] = useState(
    apiSidebarTab || API_SIDEBAR_NAVS[0].value,
  );
  const [currentConnection, setCurrentConnection] = useState<any>(null);
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
    setActiveTab(apiSidebarTab || API_SIDEBAR_NAVS[0].value);
  }, [apiSidebarTab]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("apiSidebarTab", tab);
    router.push(`${pathname}?${searchParams.toString()}`);
  };

  const totalGroups = currentAPI?.groups?.length || 0;
  // const totalEndpoints = currentAPI?.endpoints?.length || 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <APIHeader
        connectionName={connectionName || ""}
        apiId={currentAPI?.id || ""}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <CustomTabList tabs={API_SIDEBAR_NAVS} activeTab={activeTab}>
          <CreateEndpointDialog connectionName={connectionName} />
        </CustomTabList>
        <CustomTabsContent value={"endpoints"}>
          {/* API List */}
          <div className="flex-1 overflow-auto p-2">
            {loading === "initializing" || loading === "fetching" ? (
              <div className="flex h-32 items-center justify-center">
                <div className="text-sm text-muted-foreground">
                  {loading === "initializing"
                    ? "Initializing APIs..."
                    : "Fetching APIs..."}
                </div>
              </div>
            ) : totalGroups === 0 && currentAPI?.endpoints?.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center text-center">
                <GroupIcon className="mb-2 h-8 w-8 text-muted-foreground" />
                <div className="mb-1 text-sm text-muted-foreground">
                  No endpoints yet
                </div>
                <div className="text-xs text-muted-foreground">
                  Create your first endpoint to get started
                </div>
              </div>
            ) : (
              currentAPI && (
                <EndpointsList
                  groups={currentAPI?.groups || []}
                  currentAPI={currentAPI}
                  apiId={currentAPI?.id || ""}
                />
              )
            )}
          </div>
        </CustomTabsContent>
        <CustomTabsContent value={"middleware"}>
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20"></div>
              <div className="relative rounded-full bg-primary/10 p-4">
                <Wrench className="h-8 w-8 text-primary/60" />
              </div>
            </div>
            
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Middleware
            </h2>
            
            <div className="mb-4 flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
              <Clock className="h-3 w-3" />
              Coming Soon
            </div>
            
            <div className="mt-6 flex flex-col gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
                Request preprocessing
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
                Response transformation
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
                Custom validation rules
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/40"></div>
                Authentication middleware
              </div>
            </div>
          </div>
        </CustomTabsContent>
      </Tabs>

      {/* Error Display */}
      {error && (
        <div className="border-t p-2">
          <div className="rounded bg-destructive/10 p-2 text-xs text-destructive">
            {error}
          </div>
        </div>
      )}
    </div>
  );
};

export default APISidebar;
