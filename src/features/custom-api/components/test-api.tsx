"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useParams } from "next/navigation";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";
import { useTestResults } from "../context/test-results-context";
import { APIEndpoint, APIDetails } from "../types/custom-api.type";
import { Play, Copy, Server, Trash2, Check } from "lucide-react";
import { testApiAction, TestResult } from "../lib/actions/test-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Editor } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import GithubDark from "@/components/views/editor/github-dark.json";
import GithubLight from "@/components/views/editor/github-light.json";

// Key-Value Input Component (Postman-like UI)
interface KeyValuePair {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

interface KeyValueInputProps {
  items: KeyValuePair[];
  onChange: (items: KeyValuePair[]) => void;
  allowAdd?: boolean;
  title: string;
}

const KeyValueInput: React.FC<KeyValueInputProps> = ({
  items,
  onChange,
  allowAdd = true,
  title,
}) => {

  // Handle item changes with debounced auto-add
  const handleItemChange = (
    id: string,
    field: keyof KeyValuePair,
    value: string | boolean,
  ) => {
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, [field]: value } : item,
    );

    onChange(updatedItems);
  };

  // Auto-add empty item when last item has content (debounced)
  const handleKeyOrValueChange = (
    id: string,
    field: "key" | "value",
    value: string,
  ) => {
    const updatedItems = items.map((item) =>
      item.id === id ? { ...item, [field]: value } : item,
    );

    // Only add new empty item if this is the last item and it now has content
    const lastItem = updatedItems[updatedItems.length - 1];
    if (lastItem && lastItem.id === id && value && allowAdd) {
      const hasEmptyItem = updatedItems.some(
        (item) => !item.key && !item.value,
      );
      if (!hasEmptyItem) {
        const newItem: KeyValuePair = {
          id: (Date.now() + Math.random()).toString(),
          key: "",
          value: "",
          enabled: true,
        };
        updatedItems.push(newItem);
      }
    }

    onChange(updatedItems);
  };

  const removeItem = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{title}</Label>
      </div>

      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No {title.toLowerCase()} added
          </div>
        ) : (
          items.map((item) => {
            const isEmpty = !item.key && !item.value;
            return (
              <div key={item.id} className="flex items-center gap-2">
                {!isEmpty && (
                  <div className="flex items-center">
                    <Checkbox
                      checked={item.enabled}
                      onCheckedChange={(checked) =>
                        handleItemChange(item.id, "enabled", checked)
                      }
                      className="mr-2"
                    />
                    {/* <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(e) => handleItemChange(item.id, "enabled", e.target.checked)}
                      className="mr-2"
                    /> */}
                  </div>
                )}
                {isEmpty && <div className="w-6" />}
                <Input
                  value={item.key}
                  onChange={(e) =>
                    handleKeyOrValueChange(item.id, "key", e.target.value)
                  }
                  placeholder="Key"
                  className="flex-1 text-sm"
                />
                <Input
                  value={item.value}
                  onChange={(e) =>
                    handleKeyOrValueChange(item.id, "value", e.target.value)
                  }
                  placeholder="Value"
                  className="flex-1 text-sm"
                />
                {allowAdd && !isEmpty && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeItem(item.id)}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
                {isEmpty && <div className="w-8" />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const TestApi = () => {
  const { apiId, endpointId } = useParams<{
    apiId: string;
    endpointId: string;
  }>();
  const { currentAPI } = useSelector((state: RootState) => state.api);
  const { addTestResult, getTestConfig, saveTestConfig } = useTestResults();
  const { resolvedTheme } = useTheme();
  const [selectedEndpoint, setSelectedEndpoint] = useState<APIEndpoint | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [requestBody, setRequestBody] = useState("");
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([
    { id: "1", key: "", value: "", enabled: true },
  ]);
  const [headers, setHeaders] = useState<KeyValuePair[]>([
    { id: "1", key: "", value: "", enabled: true },
  ]);
  const [urlParams, setUrlParams] = useState<KeyValuePair[]>([]);
  const [isCopied, setIsCopied] = useState(false);

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

  const isBodyRequired = ["POST", "PUT", "PATCH"].includes(
    selectedEndpoint?.method || "",
  );

  useEffect(() => {
    if (currentAPI && endpointId) {
      const endpoint = currentAPI.endpoints.find((ep) => ep.id === endpointId);
      if (endpoint) {
        setSelectedEndpoint(endpoint);

        // Load saved test configuration
        const savedConfig = getTestConfig(endpointId);
        if (savedConfig) {
          setRequestBody(savedConfig.requestBody || "");
          setQueryParams(
            savedConfig.queryParams.length > 0
              ? savedConfig.queryParams
              : [{ id: "1", key: "", value: "", enabled: true }],
          );
          setHeaders(
            savedConfig.headers.length > 0
              ? savedConfig.headers
              : [{ id: "1", key: "", value: "", enabled: true }],
          );
        } else {
          // Initialize with empty key-value pairs if no saved config
          setQueryParams([{ id: "1", key: "", value: "", enabled: true }]);
          setHeaders([{ id: "1", key: "", value: "", enabled: true }]);
        }

        // Extract URL parameters from endpoint path
        const pathParams = extractUrlParams(endpoint.path);
        setUrlParams(pathParams);
      }
    }
  }, [currentAPI, endpointId]);

  // Auto-save configuration when values change
  useEffect(() => {
    if (
      endpointId &&
      (requestBody || queryParams.length > 0 || headers.length > 0)
    ) {
      saveTestConfig(endpointId, {
        requestBody,
        queryParams,
        headers,
        urlParams,
      });
    }
  }, [requestBody, queryParams, headers, urlParams, endpointId]);

  // Extract URL parameters from path (e.g., /users/:id -> [{ key: "id", value: "", enabled: true }])
  const extractUrlParams = (path: string): KeyValuePair[] => {
    const paramMatches = path.match(/:([a-zA-Z0-9_]+)/g);
    if (!paramMatches) return [];

    return paramMatches.map((match, index) => ({
      id: `url-param-${index}`,
      key: match.substring(1), // Remove the ':'
      value: "",
      enabled: true,
    }));
  };

  const buildUrl = (endpoint: APIEndpoint) => {
    let path = endpoint.path;

    // Replace URL parameters in path
    urlParams.forEach((param) => {
      if (param.enabled && param.value) {
        path = path.replace(`:${param.key}`, param.value);
      }
    });

    const url = new URL(baseUrl);
    url.pathname = path;

    // Add query parameters
    const enabledQueryParams = queryParams.filter(
      (param) => param.enabled && param.key && param.value,
    );
    if (enabledQueryParams.length > 0) {
      const params = new URLSearchParams();
      enabledQueryParams.forEach((param) => {
        params.append(param.key, param.value);
      });
      url.search = params.toString();
    }

    return url.toString();
  };

  const testEndpoint = async () => {
    if (!selectedEndpoint || !currentAPI || !endpointId) return;

    setIsLoading(true);

    try {
      const url = buildUrl(selectedEndpoint);
      const requestHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Add custom headers
      const enabledHeaders = headers.filter(
        (header) => header.enabled && header.key && header.value,
      );
      enabledHeaders.forEach((header) => {
        requestHeaders[header.key] = header.value;
      });

      // Prepare body for methods that support it
      let body: any = undefined;
      if (
        ["POST", "PUT", "PATCH"].includes(selectedEndpoint.method) &&
        requestBody.trim()
      ) {
        try {
          body = JSON.parse(requestBody);
        } catch (error) {
          const result: TestResult = {
            status: "error",
            error: "Invalid JSON in request body",
            timestamp: new Date(),
          };
          addTestResult(endpointId, result);
          setIsLoading(false);
          return;
        }
      }

      // Call server action
      const response = await testApiAction(
        selectedEndpoint.method,
        url,
        body,
        requestHeaders,
      );

      if (response.success && response.result) {
        addTestResult(endpointId, response.result);
      } else {
        const result: TestResult = {
          status: "error",
          error: response.error || "Unknown error",
          timestamp: new Date(),
        };
        addTestResult(endpointId, result);
      }
    } catch (error) {
      const result: TestResult = {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
      addTestResult(endpointId, result);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
    } catch (error) {
      console.error("Failed to copy text: ", error);
    }
  };

  const handleEditor = async (editor: any, monaco: any) => {
    monaco.editor.defineTheme("github-dark", GithubDark);
    monaco.editor.defineTheme("github-light", GithubLight);
    monaco.editor.setTheme(
      resolvedTheme === "dark" ? "github-dark" : "github-light",
    );
  };

  if (!currentAPI || !selectedEndpoint) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Server className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold">No Endpoint Selected</h2>
          <p className="text-muted-foreground">
            Please select an endpoint to test.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      {/* Endpoint Info */}
      <div className="sticky top-0 flex items-center justify-between gap-2 rounded-lg border bg-background px-4 py-2">
        <div className="flex flex-1 items-center gap-3">
          <Badge variant="outline" className="text-xs">
            {selectedEndpoint.method}
          </Badge>
          {/* <div>
            <h3 className="font-medium">{selectedEndpoint.name}</h3>
          </div> */}
          <div className="flex h-8 flex-1 items-center gap-2">
            <div className="group relative flex-1">
              <Input
                id="url"
                value={buildUrl(selectedEndpoint)}
                onChange={() => {}}
                title={buildUrl(selectedEndpoint)}
                className="border-border bg-secondary pr-10 font-mono text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(buildUrl(selectedEndpoint))}
                className={`absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0 opacity-0 transition-opacity duration-200 hover:bg-secondary/80 group-hover:opacity-100 ${
                  isCopied ? "opacity-100" : ""
                }`}
              >
                {isCopied ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={"outline"}
            onClick={testEndpoint}
            disabled={isLoading}
            className="h-8 border-border bg-secondary text-xs text-foreground"
          >
            <Play />
            {isLoading ? "Running..." : "Run"}
          </Button>
        </div>
      </div>

      {/* Request Configuration */}
      <div className="flex-1">
        <Tabs defaultValue="params" className="h-full">
          <TabsList className="border border-border bg-secondary">
            <TabsTrigger value="params">Params</TabsTrigger>
            <TabsTrigger value="query">Query</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            {isBodyRequired && <TabsTrigger value="body">Body</TabsTrigger>}
          </TabsList>
          <TabsContent value="params">
            <KeyValueInput
              items={urlParams}
              onChange={setUrlParams}
              allowAdd={false}
              title="URL Parameters"
            />
          </TabsContent>
          <TabsContent value="query">
            <KeyValueInput
              items={queryParams}
              onChange={setQueryParams}
              allowAdd={true}
              title="Query Parameters"
            />
          </TabsContent>
          <TabsContent value="headers">
            <KeyValueInput
              items={headers}
              onChange={setHeaders}
              allowAdd={true}
              title="Headers"
            />
          </TabsContent>
          {isBodyRequired && (
            <TabsContent value="body" style={{ height: "calc(100% - 3rem)" }}>
              <div className="overflow-hidden rounded-md border h-full">
                <Editor
                  language="json"
                  value={requestBody}
                  onChange={(value) => setRequestBody(value || "")}
                  defaultLanguage="json"
                  theme={resolvedTheme === "dark" ? "github-dark" : "github-light"}
                  onMount={(editor, monaco) => {
                    handleEditor(editor, monaco);
                  }}
                  options={{
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    fontSize: 14,
                    lineNumbers: "on",
                    glyphMargin: false,
                    roundedSelection: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    folding: true,
                    showFoldingControls: "always",
                    renderLineHighlight: "all",
                    cursorBlinking: "smooth",
                    cursorSmoothCaretAnimation: "on",
                    readOnly: false,
                    lineNumbersMinChars: 3,
                    padding: { top: 8, bottom: 8 },
                  }}
                />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default TestApi;
