import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AVAILABLE_NODE_TYPES } from "@/features/custom-api/config/workbench-config";
import { useWorkbenchRedux } from "@/features/custom-api/hooks/use-workbench-redux";
import { toast } from "sonner";

const NodeTypesList = () => {
  const {
    currentEndpointState,
    selectedNodeType,
    getCurrentPendingSourceId,
    selectAndAddNode,
  } = useWorkbenchRedux();

  // Check if parent node already has a response node (including in child flow)
  const checkParentHasResponseNode = (nodeType: string) => {
    if (nodeType !== "responseNode") return false;

    if (!currentEndpointState || !getCurrentPendingSourceId()) return false;

    // Check if the parent is a conditional node - if so, allow multiple response nodes
    const pendingSourceId = getCurrentPendingSourceId();
    const parentNode = currentEndpointState.nodes.find(
      (node) => node.id === pendingSourceId,
    );
    if (parentNode && (parentNode.data as any).type === "conditionalNode") {
      return false; // Allow multiple response nodes for conditional nodes
    }

    // Recursively check if there are any response nodes in the child flow
    const hasResponseNodeInFlow = (
      nodeId: string,
      visited: Set<string> = new Set(),
    ): boolean => {
      if (visited.has(nodeId)) return false; // Prevent infinite loops
      visited.add(nodeId);

      // Find all outgoing edges from this node
      const outgoingEdges = currentEndpointState.edges.filter(
        (edge) => edge.source === nodeId,
      );

      for (const edge of outgoingEdges) {
        const targetNode = currentEndpointState.nodes.find(
          (node) => node.id === edge.target,
        );
        if (targetNode) {
          // If target is a response node, return true
          if (targetNode.type === "responseNode") {
            return true;
          }
          // Recursively check the target node's children
          if (hasResponseNodeInFlow(edge.target, visited)) {
            return true;
          }
        }
      }

      return false;
    };

    return hasResponseNodeInFlow(pendingSourceId!);
  };

  // Check if parent node already has a conditional node
  const checkParentHasConditionalNode = (nodeType: string) => {
    if (nodeType !== "conditionalNode") return false;

    if (!currentEndpointState || !getCurrentPendingSourceId()) return false;

    // Check if there are any edges from the pending source to conditional nodes
    const pendingSourceId = getCurrentPendingSourceId();
    const hasConditionalNode = currentEndpointState.edges.some((edge) => {
      if (edge.source !== pendingSourceId) return false;

      // Find the target node
      const targetNode = currentEndpointState.nodes.find(
        (node) => node.id === edge.target,
      );
      return targetNode?.type === "conditionalNode";
    });

    return hasConditionalNode;
  };

  const handleNodeTypeClick = (nodeType: string) => {
    // Check if trying to add response node when parent already has one
    if (checkParentHasResponseNode(nodeType)) {
      toast.error(
        "You can't add more than 1 response node to the same parent node.",
      );
      return;
    }

    // Check if trying to add conditional node when parent already has one
    if (checkParentHasConditionalNode(nodeType)) {
      toast.error(
        "You can't add more than 1 conditional node to the same parent node.",
      );
      return;
    }

    selectAndAddNode(nodeType);
  };

  return (
    <div className="space-y-2">
      {AVAILABLE_NODE_TYPES.map((nodeType) => {
        const IconComponent = nodeType.icon;
        const isSelected = selectedNodeType === nodeType.id;
        const isResponseNodeDisabled = checkParentHasResponseNode(nodeType.id);
        const isConditionalNodeDisabled = checkParentHasConditionalNode(
          nodeType.id,
        );
        let isDisabled = isResponseNodeDisabled || isConditionalNodeDisabled;
        if (nodeType.id === "conditionalNode") {
          isDisabled = isConditionalNodeDisabled;
        } else {
          isDisabled = isResponseNodeDisabled || isConditionalNodeDisabled;
        }

        return (
          <Card
            key={nodeType.id}
            className={cn(
              "cursor-pointer border-border bg-background opacity-100 transition-all duration-200 hover:shadow-md",
              isSelected && "ring-2 ring-primary",
              isDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            <CardContent className="px-2 py-1">
              <div className="flex items-center">
                {/* Icon */}
                <div
                  className={cn(
                    "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-white",
                  )}
                >
                  {IconComponent && <IconComponent className="h-4 w-4" />}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-sm font-medium text-foreground">
                      {nodeType.name}
                    </h4>
                  </div>
                </div>

                {/* Add Icon */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleNodeTypeClick(nodeType.id)}
                  disabled={isDisabled}
                  className="border-border bg-secondary"
                >
                  Add
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default NodeTypesList;
