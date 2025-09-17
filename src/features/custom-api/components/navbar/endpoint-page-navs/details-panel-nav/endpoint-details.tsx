"use client";

import React, { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Save } from "lucide-react";
import { APIEndpoint, APIParameter } from "@/features/custom-api/types/custom-api.type";
import { toast } from "sonner";
import { AppDispatch, RootState } from "@/redux/store";
import { updateEndPoint } from "@/features/custom-api/utils/data-thunk-func";
import { useParams } from "next/navigation";
import { API_METHOD_COLORS } from "@/features/custom-api/config/api-config";
import { cn } from "@/lib/utils";
import { restartCustomServerAction } from "@/features/custom-api/lib/actions/server";

const EndpointDetails: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { currentAPI, loading } = useSelector((state: RootState) => state.api);
  const { endpointId } = useParams<{ endpointId: string }>();
  // Find the endpoint from the current API
  const endpoint = endpointId
    ? currentAPI?.endpoints.find((ep) => ep.id === endpointId)
    : undefined;

  const [parameters, setParameters] = useState<APIParameter[]>(
    endpoint?.parameters || [],
  );
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isDirty },
  } = useForm<APIEndpoint>({
    defaultValues: endpoint || {
      id: "",
      name: "",
      fullPath: "",
      path: "",
      method: "GET",
      description: "",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const watchedValues = watch();
  const methodColor =
    API_METHOD_COLORS[watchedValues.method as keyof typeof API_METHOD_COLORS];

  // Update form when endpoint prop changes
  useEffect(() => {
    if (endpoint) {
      setValue("name", endpoint.name);
      setValue("path", endpoint.path);
      setValue("method", endpoint.method);
      setValue("description", endpoint.description || "");
      setValue("enabled", endpoint.enabled);
      setParameters(endpoint.parameters || []);
    }
  }, [endpoint, setValue]);

  const onSubmit = async (data: APIEndpoint) => {
    if (!endpointId || !currentAPI?.connectionId) {
      toast.error("Missing endpoint or connection information");
      return;
    }

    setIsSaving(true);
    try {
      const updatedEndpoint: APIEndpoint = {
        ...data,
        id: endpointId,
        fullPath: data.path.startsWith("/") ? data.path : `/${data.path}`,
        parameters,
        updatedAt: new Date(),
      };

      await dispatch(
        updateEndPoint({
          connectionId: currentAPI.connectionId,
          endpointId,
          endpoint: updatedEndpoint,
        }),
      );

      const updatedEndpoints = currentAPI?.endpoints.map((ep) => ep.id === endpointId ? updatedEndpoint : ep);

      const restartServer = restartCustomServerAction({...currentAPI, endpoints: updatedEndpoints});

       toast.promise(restartServer, {
         loading: "Restarting server...",
         success: "Server restarted successfully",
         error: "Failed to restart server",
       });

       // Reset form to remove isDirty state
       reset(updatedEndpoint);
       
       toast.success("Endpoint saved successfully");
    } catch (error) {
      toast.error("Failed to save endpoint");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnableEndpoint = async (enabled: boolean) => {
    if (!endpointId || !currentAPI?.connectionId) {
      toast.error("Missing endpoint or connection information");
      return;
    }
    try {
      setValue("enabled", enabled);
      await dispatch(
        updateEndPoint({
          connectionId: currentAPI.connectionId,
          endpointId,
          endpoint: { ...endpoint, enabled, id: endpointId } as APIEndpoint,
        }),
      );
      const updatedEndpoints = currentAPI?.endpoints.map((ep) => ep.id === endpointId ? { ...ep, enabled } : ep);
      const restartServer = restartCustomServerAction({...currentAPI, endpoints: updatedEndpoints});
      toast.promise(restartServer, {
        loading: "Restarting server...",
        success: "Server restarted successfully",
        error: "Failed to restart server",
      });
    } catch (error) {
      toast.error("Failed to enable endpoint");
    }
  };

  // Show loading state
  if (loading === "fetching" || loading === "initializing") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">
            Loading endpoint details...
          </div>
        </div>
      </div>
    );
  }

  // Show error if endpoint not found
  if (endpointId && !endpoint) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-sm text-destructive">Endpoint not found</div>
          <div className="mt-1 text-xs text-muted-foreground">
            The requested endpoint could not be found
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tabs */}
      <div className="p-4">
        <div className="flex items-center justify-between rounded-lg bg-background border px-4 py-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  `border border-gray-200 bg-gray-100 text-gray-800`,
                )}
                style={{...methodColor}}
              >
                {watchedValues.method}
              </Badge>
              <span className="font-medium">
                {watchedValues.name || "Untitled Endpoint"}
              </span>
            </div>
            <Badge variant="outline" className="text-xs">
              {watchedValues.path || "/path"}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={watchedValues.enabled}
              onCheckedChange={handleEnableEndpoint}
              className="!bg-secondary"
              thumbClassName="bg-background"
            />
            <Label className="text-sm">Enabled</Label>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Endpoint Name *</Label>
              <Input
                id="name"
                {...register("name", { required: "Name is required" })}
                placeholder="e.g., Get User Profile"
                className="bg-background border-b border-border"
              />
              {errors.name && (
                <p className="text-sm text-red-500">{errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">HTTP Method *</Label>
              <Select
                value={watchedValues.method}
                onValueChange={(value) => setValue("method", value as any, { shouldDirty: true })}
              >
                <SelectTrigger className="bg-background border-b border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="path">Path *</Label>
            <Input
              id="path"
              {...register("path", { required: "Path is required" })}
              placeholder="/api/users/profile"
              className="bg-background border-b border-border"
            />
            {errors.path && (
              <p className="text-sm text-red-500">{errors.path.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              {...register("description")}
              placeholder="Describe what this endpoint does..."
              rows={3}
              className="bg-background border-b border-border"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-4 pb-4">
        <div className="text-sm text-muted-foreground">
          {isDirty && "You have unsaved changes"}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSubmit(onSubmit)}
            disabled={isSaving || !isDirty}
            className="flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EndpointDetails;
