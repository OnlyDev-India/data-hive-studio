import { useState, useCallback, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlayIcon, LoaderIcon } from "lucide-react";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";
import { EndpointNodeData } from "@/features/custom-api/types/custom-api.type";
import {
  EndpointFlowExecutor,
  NodeExecutionStep,
} from "../flow-executor/endpoint-flow-executor";
import JsonEditor from "./json-editor";

interface FlowExecutionResult {
  statusCode: number;
  data?: any;
  message?: string;
  error?: string;
  executionTime?: number;
}

interface FlowTestFormData {
  params: string;
  query: string;
  headers: string;
  body: string;
}

const EndpointFlowTester = () => {
  const { getCurrentSelectedNodeId, currentEndpointState } = useWorkbenchRedux();
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] =
    useState<FlowExecutionResult | null>(null);
  const [executionSteps, setExecutionSteps] = useState<NodeExecutionStep[]>([]);

  const selectedNodeId = getCurrentSelectedNodeId();
  const selectedNode = currentEndpointState?.nodes.find(
    (node) => node.id === selectedNodeId,
  );

  const endpointData = selectedNode?.data as EndpointNodeData;
  const endpoint = endpointData.endpoint;

  // Generate default values based on endpoint parameters and path
  const generateDefaultValues = () => {
    const defaults: FlowTestFormData = {
      params: JSON.stringify({}),
      query: JSON.stringify({}),
      headers: JSON.stringify({ "content-type": "application/json" }, null, 2),
      body: JSON.stringify({}),
    };

    // Extract path parameters from the endpoint path
    const extractPathParams = (path: string) => {
      const pathParams: Record<string, any> = {};
      const pathSegments = path.split("/");

      pathSegments.forEach((segment) => {
        // Check if segment is a path parameter (starts with :)
        if (segment.startsWith(":")) {
          const paramName = segment.substring(1); // Remove the :
          // Generate realistic default values based on parameter name
          if (paramName.toLowerCase().includes("id")) {
            pathParams[paramName] = "123";
          } else if (paramName.toLowerCase().includes("user")) {
            pathParams[paramName] = "user123";
          } else if (paramName.toLowerCase().includes("post")) {
            pathParams[paramName] = "post456";
          } else if (paramName.toLowerCase().includes("category")) {
            pathParams[paramName] = "tech";
          } else if (paramName.toLowerCase().includes("slug")) {
            pathParams[paramName] = "example-slug";
          } else if (paramName.toLowerCase().includes("uuid")) {
            pathParams[paramName] = "550e8400-e29b-41d4-a716-446655440000";
          } else {
            pathParams[paramName] = "example";
          }
        }
      });

      return pathParams;
    };

    // Generate default params based on endpoint path and parameters
    const pathParams = extractPathParams(endpoint.fullPath);
    const queryParams: Record<string, any> = {};

    // Also check endpoint.parameters for additional path params or overrides
    if (endpoint.parameters) {
      endpoint.parameters.forEach((param: any) => {
        if (param.in === "path") {
          // Use parameter definition if available, otherwise use extracted value
          if (!pathParams[param.name]) {
            pathParams[param.name] = param.defaultValue || `{{${param.name}}}`;
          } else if (param.defaultValue) {
            pathParams[param.name] = param.defaultValue;
          }
        } else if (param.in === "query" && param.required) {
          // Generate realistic default values for query parameters
          if (param.name.toLowerCase().includes("page")) {
            queryParams[param.name] = 1;
          } else if (
            param.name.toLowerCase().includes("limit") ||
            param.name.toLowerCase().includes("size")
          ) {
            queryParams[param.name] = 10;
          } else if (param.name.toLowerCase().includes("search")) {
            queryParams[param.name] = "example";
          } else if (param.name.toLowerCase().includes("sort")) {
            queryParams[param.name] = "created_at";
          } else if (param.name.toLowerCase().includes("order")) {
            queryParams[param.name] = "desc";
          } else if (param.name.toLowerCase().includes("filter")) {
            queryParams[param.name] = "active";
          } else if (param.name.toLowerCase().includes("status")) {
            queryParams[param.name] = "published";
          } else {
            queryParams[param.name] = param.defaultValue || `{{${param.name}}}`;
          }
        }
      });
    }

    // Set the generated values
    if (Object.keys(pathParams).length > 0) {
      defaults.params = JSON.stringify(pathParams, null, 2);
    }
    if (Object.keys(queryParams).length > 0) {
      defaults.query = JSON.stringify(queryParams, null, 2);
    }

    return defaults;
  };

  // Create validation schema based on endpoint parameters
  const createValidationSchema = () => {
    const schemaFields: Record<string, any> = {
      params: z.string().refine((val) => {
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      }, "Invalid JSON format"),
      query: z.string().refine((val) => {
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      }, "Invalid JSON format"),
      headers: z.string().refine((val) => {
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      }, "Invalid JSON format"),
      body: z.string().refine((val) => {
        try {
          JSON.parse(val);
          return true;
        } catch {
          return false;
        }
      }, "Invalid JSON format"),
    };

    // Extract required path parameters from both path and parameters definition
    const extractRequiredPathParams = () => {
      const pathParams: string[] = [];

      // Extract from path segments
      const pathSegments = endpoint.fullPath.split("/");
      pathSegments.forEach((segment: string) => {
        if (segment.startsWith(":")) {
          pathParams.push(segment.substring(1));
        }
      });

      // Also check endpoint.parameters for additional path params
      if (endpoint.parameters) {
        endpoint.parameters.forEach((param: any) => {
          if (
            param.in === "path" &&
            param.required &&
            !pathParams.includes(param.name)
          ) {
            pathParams.push(param.name);
          }
        });
      }

      return pathParams;
    };

    // Add required validation for path parameters
    const requiredPathParams = extractRequiredPathParams();
    if (requiredPathParams.length > 0) {
      schemaFields.params = schemaFields.params.refine(
        (val: string) => {
          try {
            const parsed = JSON.parse(val);
            return requiredPathParams.every(
              (paramName: string) =>
                parsed.hasOwnProperty(paramName) && parsed[paramName] !== "",
            );
          } catch {
            return false;
          }
        },
        `Required path parameters: ${requiredPathParams.join(", ")}`,
      );
    }

    // Add required validation for query parameters
    if (endpoint.parameters) {
      const requiredQueryParams = endpoint.parameters.filter(
        (p: any) => p.in === "query" && p.required,
      );
      if (requiredQueryParams.length > 0) {
        schemaFields.query = schemaFields.query.refine(
          (val: string) => {
            try {
              const parsed = JSON.parse(val);
              return requiredQueryParams.every(
                (param: any) =>
                  parsed.hasOwnProperty(param.name) &&
                  parsed[param.name] !== "",
              );
            } catch {
              return false;
            }
          },
          `Required query parameters: ${requiredQueryParams.map((p: any) => p.name).join(", ")}`,
        );
      }
    }

    return z.object(schemaFields);
  };

  const validationSchema = createValidationSchema();
  const defaultValues = generateDefaultValues();

  const {
    control,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<FlowTestFormData>({
    resolver: zodResolver(validationSchema),
    defaultValues,
    mode: "onChange",
  });

  // Reset form when endpoint changes
  useEffect(() => {
    reset(generateDefaultValues());
  }, [endpoint.id]);

  const executeFlow = useCallback(
    async (data: FlowTestFormData) => {
      if (!currentEndpointState || !selectedNodeId) return;

      setIsExecuting(true);
      setExecutionResult(null);
      setExecutionSteps([]);

      try {
        const startTime = Date.now();

        // Parse input data
        const parsedParams = JSON.parse(data.params);
        const parsedQuery = JSON.parse(data.query);
        const parsedHeaders = JSON.parse(data.headers);
        const parsedBody = JSON.parse(data.body);

        // Create EndpointFlowExecutor instance
        const flowExecutor = new EndpointFlowExecutor(selectedNodeId);

        // Set up step update callback
        flowExecutor.setStepUpdateCallback((steps) => {
          setExecutionSteps([...steps]);
        });

        // Initialize the flow with current workbench data
        flowExecutor.initializeFlow(
          currentEndpointState.nodes,
          currentEndpointState.edges,
        );

        // Set the execution context with user input
        flowExecutor.setContext({
          params: parsedParams,
          query: parsedQuery,
          headers: parsedHeaders,
          body: parsedBody,
        });

        // Execute the flow
        const result = await flowExecutor.execute();

        console.log("result", result);

        const executionTime = Date.now() - startTime;

        setExecutionResult({
          statusCode: result.statusCode,
          data: result.data,
          message: result.message,
          error: result.error,
          executionTime,
        });
      } catch (error) {
        setExecutionResult({
          statusCode: 500,
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
          executionTime: Date.now() - Date.now(),
        });
      } finally {
        setIsExecuting(false);
      }
    },
    [currentEndpointState, selectedNodeId],
  );

  if (!selectedNode || selectedNode.data.type !== "endpointNode") {
    return null;
  }

  return (
    <div className="mt-4 space-y-4 overflow-auto">
      <>
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-medium">
            Test Flow: {endpoint.name}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{endpoint.method}</Badge>
            <span className="text-xs text-muted-foreground">
              {endpoint.fullPath}
            </span>
          </div>
        </div>
        <CardContent className="space-y-2">
          <form onSubmit={handleSubmit(executeFlow)} className="space-y-4">
            {/* Path Parameters */}
            {(endpoint.fullPath.includes(":") ||
              endpoint.parameters?.some((p: any) => p.in === "path")) && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">
                  Path Parameters
                  {(endpoint.fullPath.includes(":") ||
                    endpoint.parameters?.some(
                      (p: any) => p.in === "path" && p.required,
                    )) && <span className="ml-1 text-destructive">*</span>}
                </Label>
                <Controller
                  name="params"
                  control={control}
                  render={({ field }) => (
                    <JsonEditor
                      value={field.value}
                      onChange={field.onChange}
                      placeholder='{"userId": "123", "postId": "456"}'
                      className="min-h-16"
                    />
                  )}
                />
                {errors.params && (
                  <p className="text-xs text-destructive">
                    {errors.params.message}
                  </p>
                )}
              </div>
            )}

            {/* Query Parameters */}
            {endpoint.parameters?.some((p: any) => p.in === "query") && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">
                  Query Parameters
                  {endpoint.parameters?.some(
                    (p: any) => p.in === "query" && p.required,
                  ) && <span className="ml-1 text-destructive">*</span>}
                </Label>
                <Controller
                  name="query"
                  control={control}
                  render={({ field }) => (
                    <JsonEditor
                      value={field.value}
                      onChange={field.onChange}
                      placeholder='{"page": 1, "limit": 10, "search": "example"}'
                      className="min-h-16"
                    />
                  )}
                />
                {errors.query && (
                  <p className="text-xs text-destructive">
                    {errors.query.message}
                  </p>
                )}
              </div>
            )}

            {/* Headers */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Headers</Label>
              <Controller
                name="headers"
                control={control}
                render={({ field }) => (
                  <JsonEditor
                    value={field.value}
                    onChange={field.onChange}
                    placeholder='{"authorization": "Bearer token", "content-type": "application/json"}'
                    className="min-h-16"
                  />
                )}
              />
              {errors.headers && (
                <p className="text-xs text-destructive">
                  {errors.headers.message}
                </p>
              )}
            </div>

            {/* Request Body */}
            {(endpoint.method === "POST" ||
              endpoint.method === "PUT" ||
              endpoint.method === "PATCH") && (
              <div className="space-y-2">
                <Label className="text-xs font-medium">Request Body</Label>
                <Controller
                  name="body"
                  control={control}
                  render={({ field }) => (
                    <JsonEditor
                      value={field.value}
                      onChange={field.onChange}
                      placeholder='{"name": "John Doe", "email": "john@example.com"}'
                      className="min-h-20"
                    />
                  )}
                />
                {errors.body && (
                  <p className="text-xs text-destructive">
                    {errors.body.message}
                  </p>
                )}
              </div>
            )}

            {/* Execute Button */}
            <Button
              type="submit"
              disabled={isExecuting || !isValid}
              className="w-full"
              size="sm"
            >
              {isExecuting ? (
                <>
                  <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
                  Executing Flow...
                </>
              ) : (
                <>
                  <PlayIcon className="mr-2 h-4 w-4" />
                  Start Flow
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </>

      {/* Execution Steps */}
      {executionSteps.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-sm font-medium">
            Flow Execution
            {executionResult && (
              <>
                <Badge
                  variant={
                    executionResult.statusCode >= 200 &&
                    executionResult.statusCode < 300
                      ? "default"
                      : "destructive"
                  }
                >
                  {executionResult.statusCode}
                </Badge>
                {executionResult.executionTime && (
                  <span className="text-xs text-muted-foreground">
                    ({executionResult.executionTime}ms)
                  </span>
                )}
              </>
            )}
          </div>
          <div className="space-y-3">
            {executionSteps.map((step, index) => (
              <div
                key={step.nodeId}
                className={`rounded-lg border p-3 transition-all duration-300 ${
                  step.status === "executing"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                    : step.status === "completed"
                      ? "border-green-500 bg-green-50 dark:bg-green-950/20"
                      : step.status === "error"
                        ? "border-red-500 bg-red-50 dark:bg-red-950/20"
                        : "border-gray-200 bg-gray-50 dark:bg-gray-950/20"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                        step.status === "executing"
                          ? "animate-pulse bg-blue-500 text-white"
                          : step.status === "completed"
                            ? "bg-green-500 text-white"
                            : step.status === "error"
                              ? "bg-red-500 text-white"
                              : "bg-gray-300 text-gray-600"
                      }`}
                    >
                      {step.status === "executing" ? (
                        <LoaderIcon className="h-3 w-3 animate-spin" />
                      ) : step.status === "completed" ? (
                        "✓"
                      ) : step.status === "error" ? (
                        "✗"
                      ) : (
                        index + 1
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{step.nodeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {step.nodeType}
                      </div>
                    </div>
                  </div>
                  {step.executionTime && (
                    <span className="text-xs text-muted-foreground">
                      {step.executionTime}ms
                    </span>
                  )}
                </div>

                {/* Step Input */}
                {step.input && (
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Input:
                    </Label>
                    <div className="rounded border bg-background p-2">
                      <pre className="overflow-auto text-xs">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Step Output */}
                {step.output && (
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs font-medium text-muted-foreground">
                      Output:
                    </Label>
                    <div className="rounded border bg-background p-2">
                      <pre className="overflow-auto text-xs">
                        {JSON.stringify(step.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Step Error */}
                {step.error && (
                  <div className="mt-2 space-y-1">
                    <Label className="text-xs font-medium text-destructive">
                      Error:
                    </Label>
                    <div className="rounded border border-destructive/20 bg-destructive/10 p-2">
                      <code className="text-xs text-destructive">
                        {step.error}
                      </code>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Final Result Summary */}
            {executionResult && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:bg-gray-950/20">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">Final Result:</div>
                  <Badge
                    variant={
                      executionResult.statusCode >= 200 &&
                      executionResult.statusCode < 300
                        ? "default"
                        : "destructive"
                    }
                  >
                    {executionResult.statusCode}
                  </Badge>
                </div>
                {executionResult.error ? (
                  <div className="mt-2 text-sm text-destructive">
                    {executionResult.error}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-green-600">
                    {executionResult.message || "Flow completed successfully"}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default EndpointFlowTester;
