"use client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ENDPOINT_PAGE_TEST_NAVS } from "@/features/custom-api/config/navs";
import { cn } from "@/lib/utils";
import {
  usePathname,
  useRouter,
  useSearchParams,
  useParams,
} from "next/navigation";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { useTestResults } from "../context/test-results-context";
import { APIEndpoint, APIDetails } from "../types/custom-api.type";
import { Button } from "@/components/ui/button";
import { Copy, Play } from "lucide-react";
import TestResultDisplay from "./test-result-display";

const ApiTestSidebar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { apiId, endpointId } = useParams<{
    apiId: string;
    endpointId: string;
  }>();
  const { currentAPI } = useSelector((state: RootState) => state.api);
  const { testResults, getTestResult } = useTestResults();
  const apiTestTab = searchParams.get("apiTestTab");

  const [activeTab, setActiveTab] = useState(
    apiTestTab || ENDPOINT_PAGE_TEST_NAVS[0].value,
  );
  const [selectedEndpoint, setSelectedEndpoint] = useState<APIEndpoint | null>(
    null,
  );
  const [requestBody, setRequestBody] = useState("");
  const [queryParams, setQueryParams] = useState("");
  const [headers, setHeaders] = useState("");

  // Get base URL - use hostUrl if available, otherwise localhost with port
  const getBaseUrl = (api: APIDetails | null) => {
    if (!api) return "http://localhost:3000";

    if (api.hostUrl) {
      return api.hostUrl;
    }

    const port = api.port || 3000;
    return `http://localhost:${port}`;
  };

  const baseUrl = getBaseUrl(currentAPI);

  useEffect(() => {
    setActiveTab(apiTestTab || ENDPOINT_PAGE_TEST_NAVS[0].value);
  }, [apiTestTab]);

  useEffect(() => {
    if (currentAPI && endpointId) {
      const endpoint = currentAPI.endpoints.find((ep) => ep.id === endpointId);
      if (endpoint) {
        setSelectedEndpoint(endpoint);
      }
    }
  }, [currentAPI, endpointId]);

  const handleNavClick = (value: string) => {
    setActiveTab(value);
    const searchParams = new URLSearchParams(window.location.search);
    searchParams.set("apiTestTab", value);
    router.push(`${pathname}?${searchParams.toString()}`);
  };

  const buildUrl = (endpoint: APIEndpoint) => {
    const url = new URL(baseUrl);
    url.pathname = endpoint.path;

    if (queryParams.trim()) {
      const params = new URLSearchParams();
      queryParams.split("&").forEach((param) => {
        const [key, value] = param.split("=");
        if (key && value) {
          params.append(key.trim(), value.trim());
        }
      });
      url.search = params.toString();
    }

    return url.toString();
  };

  const generateCurlCommand = (endpoint: APIEndpoint) => {
    const url = buildUrl(endpoint);
    let curlCommand = `curl -X ${endpoint.method} "${url}"`;

    // Add headers
    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (headers.trim()) {
      headers.split("\n").forEach((header) => {
        const [key, value] = header.split(":");
        if (key && value) {
          requestHeaders[key.trim()] = value.trim();
        }
      });
    }

    Object.entries(requestHeaders).forEach(([key, value]) => {
      curlCommand += ` \\\n  -H "${key}: ${value}"`;
    });

    // Add body for methods that support it
    if (
      ["POST", "PUT", "PATCH"].includes(endpoint.method) &&
      requestBody.trim()
    ) {
      curlCommand += ` \\\n  -d '${requestBody}'`;
    }

    return curlCommand;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Tabs
      defaultValue={ENDPOINT_PAGE_TEST_NAVS[0].value}
      value={activeTab}
      onValueChange={handleNavClick}
      className="relative h-full w-full rounded-lg bg-secondary"
    >
      <div className="no-scrollbar flex w-full items-center justify-between overflow-auto rounded-t-lg border-b pr-2">
        <TabsList className="no-scrollbar h-[var(--tabs-height)] w-full justify-start overflow-auto rounded-none bg-secondary p-2">
          {ENDPOINT_PAGE_TEST_NAVS.map((nav) => {
            const Icon = nav.icon;
            const isActive = activeTab === nav.value;
            return (
              <div
                key={nav.value}
                className={cn(
                  "group flex h-full items-center justify-between rounded-md border border-transparent hover:bg-background active:cursor-grabbing",
                  {
                    "border-primary bg-primary/20 hover:bg-primary/40":
                      isActive,
                  },
                )}
              >
                <TabsTrigger
                  value={nav.value}
                  className="h-full rounded-md bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:bg-transparent"
                >
                  <span className="flex items-center gap-1 text-xs">
                    {Icon && (
                      <Icon
                        size={14}
                        className={cn({
                          "text-primary": isActive,
                        })}
                      />
                    )}
                    {nav.label}
                  </span>
                </TabsTrigger>
              </div>
            );
          })}
        </TabsList>
      </div>
      <CustomTabsContent value={"code"}>
        <div className="over h-full space-y-4 p-4">
          {!selectedEndpoint ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground">No endpoint selected</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">cURL Command</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(generateCurlCommand(selectedEndpoint))
                    }
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {generateCurlCommand(selectedEndpoint)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </CustomTabsContent>
      <CustomTabsContent value={"response"}>
        <div className="scrollbar-gutter custom-scrollbar h-full space-y-4 overflow-auto p-4">
          {!selectedEndpoint ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground">No endpoint selected</p>
              </div>
            </div>
          ) : (
            <>
              <>
                <h4 className="text-sm font-medium">Response</h4>
                {!endpointId || !getTestResult(endpointId) ? (
                  <div className="py-8 text-center text-muted-foreground">
                    <Play className="mx-auto mb-2 h-8 w-8 opacity-50" />
                    <p className="text-sm">No tests run yet</p>
                    <p className="text-xs">
                      {`Click "Test Endpoint" to get started`}
                    </p>
                  </div>
                ) : (
                  <>
                    {(() => {
                      const result = getTestResult(endpointId);
                      if (!result) return null;

                      return (
                        <TestResultDisplay
                          result={result}
                        />
                      );
                    })()}
                  </>
                )}
              </>
            </>
          )}
        </div>
      </CustomTabsContent>
    </Tabs>
  );
};

const CustomTabsContent = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) => {
  return (
    <TabsContent
      value={value}
      className="m-0 h-[calc(100%-var(--tabs-height))] p-0"
    >
      {children}
    </TabsContent>
  );
};

export default ApiTestSidebar;
