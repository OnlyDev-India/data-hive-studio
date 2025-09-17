import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Handle, Position } from "@xyflow/react";
import React from "react";
import { PlusIcon } from "lucide-react";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";

interface CustomHandleProps {
  hasChildren?: boolean;
  nodeId: string;
  style?: React.CSSProperties;
  handleId?: string; // For conditional nodes
  handleType?: 'true' | 'false'; // For conditional nodes
  disableAddButton?: boolean;
}

export const CustomHandle = ({ hasChildren, nodeId, style, handleId, handleType, disableAddButton }: CustomHandleProps) => {
  const {startAddNode} = useWorkbenchRedux();
  
  // Get handle color based on type (for conditional nodes)
  const getHandleColor = () => {
    if (handleType === 'true') return 'bg-green-500';
    if (handleType === 'false') return 'bg-red-500';
    return 'bg-primary';
  };
  
  const getHoverColor = () => {
    if (handleType === 'true') return 'hover:bg-green-500/80';
    if (handleType === 'false') return 'hover:bg-red-500/80';
    return 'hover:bg-primary/80';
  };
  
  return (
    <div className="absolute right-0 top-1/2 -translate-y-1/2 transform" style={style}>
      {/* Always render handle for React Flow */}
      <Handle
        type="source"
        position={Position.Right}
        id={handleId} // Use the handleId for conditional nodes
        className={cn(
          "h-3 w-3 border-2 border-background transition-all duration-200",
          getHandleColor(),
          getHoverColor(),
        )}
        style={{ right: -6 }}
      />

      {/* Add button - always present but styled differently based on children */}
      {startAddNode && !disableAddButton && (
        <Button
          size="sm"
          variant="outline"
          className={cn(
            "absolute top-1/2 ml-2 h-6 w-6 -translate-y-1/2 rounded-full p-0 shadow-lg transition-all duration-200",
            !hasChildren
              ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-primary bg-background opacity-0 hover:bg-primary hover:text-primary-foreground group-hover:opacity-100",
          )}
          style={{ right: -14 }}
          onClick={(e) => {
            e.stopPropagation();
            startAddNode(nodeId, handleId || "true");
          }}
        >
          <PlusIcon className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};

