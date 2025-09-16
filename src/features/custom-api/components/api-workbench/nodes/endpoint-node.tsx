import { Node, NodeProps, Position, Handle } from "@xyflow/react";
import {
  ZapIcon, SettingsIcon,
  PlayIcon,
  PauseIcon,
  ClockIcon, ActivityIcon,
  ArrowRightIcon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { APIEndpoint } from "@/features/custom-api/types/custom-api.type";
import { CustomHandle } from "../custom";
import { BaseNode } from "./base-node";
import { useSelector } from "react-redux";
import { RootState } from "@/redux/store";

type EndpointNodeData = {
  endpoint: APIEndpoint;
  isSelected?: boolean;
  isHighlighted?: boolean;
  hasChildren?: boolean;
};

type EndpointNode = Node<EndpointNodeData>;

export function EndpointNode({
  id,
  data,
  selected,
}: NodeProps<EndpointNode>) {
  const { hasChildren } = data;
  const { currentAPI } = useSelector((state: RootState) => state.api);
  
  const getMethodColor = (method: string) => {
    const colors = {
      GET: "bg-green-500/20 text-green-600 border-green-500/30",
      POST: "bg-blue-500/20 text-blue-600 border-blue-500/30",
      PUT: "bg-yellow-500/20 text-yellow-600 border-yellow-500/30",
      DELETE: "bg-red-500/20 text-red-600 border-red-500/30",
      PATCH: "bg-purple-500/20 text-purple-600 border-purple-500/30",
    };
    return colors[method as keyof typeof colors] || "bg-gray-500/20 text-gray-600 border-gray-500/30";
  };

  const getStatusColor = (enabled: boolean) => {
    return enabled 
      ? "bg-green-500/20 text-green-600 border-green-500/30" 
      : "bg-gray-500/20 text-gray-600 border-gray-500/30";
  };

  const endpoint = currentAPI?.endpoints.find((ep) => ep.id === id);

  if (!endpoint) {
    return null;
  }

  return (
    <BaseNode 
      className={cn(
        !endpoint.enabled && "opacity-60",
        "hover:shadow-xl hover:scale-[1.02]"
      )}
      id={id}
    >
      
      <CardContent className="p-3">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10">
              <ZapIcon className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate" title={endpoint.name}>
                {endpoint.name}
              </h3>
              <p className="text-xs text-muted-foreground truncate" title={endpoint.description}>
                {endpoint.description || "No description"}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <Badge 
              variant="outline" 
              className={cn("text-xs px-2 py-1", getStatusColor(endpoint.enabled))}
            >
              {endpoint.enabled ? (
                <>
                  <PlayIcon className="h-3 w-3 mr-1" />
                  Active
                </>
              ) : (
                <>
                  <PauseIcon className="h-3 w-3 mr-1" />
                  Inactive
                </>
              )}
            </Badge>
          </div>
        </div>

        {/* Method and Path */}
        <div className="space-y-2 mb-2">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "text-xs px-2 py-1 font-mono",
                getMethodColor(endpoint.method)
              )}
            >
              {endpoint.method}
            </Badge>
            <div className="flex-1 min-w-0">
              <code className="text-xs text-muted-foreground truncate block" title={endpoint.fullPath}>
                {endpoint.fullPath}
              </code>
            </div>
          </div>
        </div>

        {/* Parameters and Responses */}
        <div className="border-t pt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">Details</span>
          </div>
          
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {endpoint.parameters && endpoint.parameters.length > 0 && (
              <div className="flex items-center gap-1">
                <SettingsIcon className="h-3 w-3" />
                <span>{endpoint.parameters.length} param{endpoint.parameters.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            {endpoint.responses && endpoint.responses.length > 0 && (
              <div className="flex items-center gap-1">
                <ArrowRightIcon className="h-3 w-3" />
                <span>{endpoint.responses.length} response{endpoint.responses.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            {endpoint.flow && (
              <div className="flex items-center gap-1">
                <ActivityIcon className="h-3 w-3" />
                <span>Flow</span>
              </div>
            )}
          </div>
        </div>

        {/* Timestamps */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <ClockIcon className="h-3 w-3" />
            <span>Created: {new Date(endpoint.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </CardContent>

       <CustomHandle hasChildren={hasChildren} nodeId={id} />
    </BaseNode>
  );
}
