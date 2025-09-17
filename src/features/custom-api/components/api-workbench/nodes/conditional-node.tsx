import React from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";
import { ConditionalNodeData } from "@/features/custom-api/types/custom-api.type";
import { GitBranchIcon } from "lucide-react";
import { BaseNode } from "./base-node";
import { Badge } from "@/components/ui/badge";
import { CustomHandle } from "../custom";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";

const ConditionalNode: React.FC<NodeProps> = ({ data, id }) => {
  const nodeData = data as unknown as ConditionalNodeData;
  const { currentEndpointState } = useWorkbenchRedux();

  // Check if specific handles have children
  const checkHandleHasChildren = (handleId: string) => {
    // if (!currentEndpointId) return false;
    
    // const currentEndpointState = currentEndpointState.endpoints[currentEndpointId];
    if (!currentEndpointState) return false;

    return currentEndpointState.edges.some(edge => 
      edge.source === id && edge.sourceHandle === handleId
    );
  };

  const trueHandleHasChildren = checkHandleHasChildren("true");
  const falseHandleHasChildren = checkHandleHasChildren("false");

  return (
    <BaseNode id={id as string}>
      <div className="relative w-64">
        {/* Header */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
                <GitBranchIcon className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {nodeData.name || "Conditional"}
                </h3>
                <p className="text-xs text-muted-foreground">Conditional Logic</p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Badge
                variant="outline"
                className="border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-600"
              >
                True
              </Badge>
              <Badge
                variant="outline"
                className="border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-600"
              >
                False
              </Badge>
            </div>
          </div>
        </div>

        {/* Input handle */}
        <Handle
          type="target"
          position={Position.Left}
          className="h-3 w-3 border-2 border-background bg-primary shadow-lg transition-colors hover:bg-primary/80"
        />

        {/* True path handle */}
        <CustomHandle
          hasChildren={trueHandleHasChildren}
          nodeId={id as string}
          handleId="true"
          handleType="true"
          style={{ top: "30%" }}
          disableAddButton={trueHandleHasChildren}
        />

        {/* False path handle */}
        <CustomHandle
          hasChildren={falseHandleHasChildren}
          nodeId={id as string}
          handleId="false"
          handleType="false"
          style={{ top: "70%" }}
          disableAddButton={falseHandleHasChildren}
        />
      </div>
    </BaseNode>
  );
};

export default ConditionalNode;
