"use client";

import React from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { BaseNode } from "./base-node";
import { Database, Hash } from "lucide-react";
import { DatabaseSelectNodeData } from "@/features/custom-api/types/custom-api.type";
import { CustomHandle } from "../custom";

export const DatabaseSelectNode: React.FC<NodeProps> = ({ data, id }) => {
  // Type assertion to ensure data is properly typed
  const nodeData = data as unknown as DatabaseSelectNodeData;

  return (
    <BaseNode id={id as string}>
      <div className="relative w-64">
        {/* Header */}
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Database className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Database Select
                </h3>
                <p className="text-xs text-muted-foreground">SQL Query</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full">
                <Hash className="h-3 w-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Table Information */}
          <div className="mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Table:</span>
              <span className="text-xs font-medium text-foreground">
                {nodeData.tableName || "Not set"}
              </span>
            </div>
          </div>

          {/* Query Name */}
          {nodeData.queryName && (
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Query:</span>
                <span className="text-xs font-medium text-foreground">
                  {nodeData.queryName}
                </span>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="mb-3 border-t border-border"></div>

          {/* Query Details */}
          <div className="space-y-2">
            {nodeData.columns && nodeData.columns.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Columns</p>
                <p className="text-xs leading-relaxed text-foreground">
                  {nodeData.columns.join(", ")}
                </p>
              </div>
            )}
            
            {nodeData.limit && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Limit</p>
                <p className="text-xs leading-relaxed text-foreground">
                  {nodeData.limit} rows
                </p>
              </div>
            )}

            {nodeData.orderBy && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Order By</p>
                <p className="text-xs leading-relaxed text-foreground">
                  {nodeData.orderBy} {nodeData.orderDirection || "ASC"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Input handle */}
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          className="h-3 w-3 border-2 border-background bg-primary shadow-lg transition-colors hover:bg-primary/80"
        />

        {/* Output handle */}
        <CustomHandle
          hasChildren={nodeData.hasChildren||false}
          nodeId={id as string}
          handleId="output"
        />
      </div>
    </BaseNode>
  );
};
