"use client";

import React from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { BaseNode } from "./base-node";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { ResponseNodeData } from "@/features/custom-api/types/custom-api.type";

export const ResponseNode: React.FC<NodeProps> = ({ data, id }) => {
  // Type assertion to ensure data is properly typed
  const nodeData = data as unknown as ResponseNodeData;

  const getStatusText = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) return "Success";
    if (statusCode >= 300 && statusCode < 400) return "Redirect";
    if (statusCode >= 400 && statusCode < 500) return "Client Error";
    if (statusCode >= 500) return "Server Error";
    return "Unknown";
  };

  return (
    <BaseNode id={id as string}>
      <div className="relative w-64">
        {/* Header */}
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <CheckCircle className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Response
                </h3>
                <p className="text-xs text-muted-foreground">API Response</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full">
                <Hash className="h-3 w-3 text-muted-foreground" />
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "border border-border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground",
                )}
              >
                {nodeData.statusCode}
              </Badge>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Status Information */}
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <span className="text-xs font-medium text-foreground">
                {getStatusText(nodeData.statusCode)}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="mb-3 border-t border-border"></div>

          {/* Description */}
          {nodeData.description && (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Description</p>
              <p className="text-xs leading-relaxed text-foreground">
                {nodeData.description}
              </p>
            </div>
          )}
        </div>

        {/* Input handle */}
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          className="h-3 w-3 border-2 border-background bg-primary shadow-lg transition-colors hover:bg-primary/80"
        />
      </div>
    </BaseNode>
  );
};
