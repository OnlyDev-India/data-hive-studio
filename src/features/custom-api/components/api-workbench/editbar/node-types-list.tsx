import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AVAILABLE_NODE_TYPES } from "@/features/custom-api/config/workbench-config";
import { useWorkbench } from "@/features/custom-api/context";

const NodeTypesList = () => {
    const { state, selectAndAddNode } = useWorkbench();

    // Check if parent node already has a response node
    const checkParentHasResponseNode = (nodeType: string) => {
      if (nodeType !== 'responseNode') return false;

      const currentEndpointState = state.currentEndpointId
        ? state.endpoints[state.currentEndpointId]
        : null;
      
      if (!currentEndpointState || !currentEndpointState.pendingSourceId) return false;
      
      // Check if the parent is a conditional node - if so, allow multiple response nodes
      const parentNode = currentEndpointState.nodes.find(node => node.id === currentEndpointState.pendingSourceId);
      if (parentNode && (parentNode.data as any).type === 'conditionalNode') {
        return false; // Allow multiple response nodes for conditional nodes
      }
      
      // Check if there are any edges from the pending source to response nodes
      const hasResponseNode = currentEndpointState.edges.some(edge => {
        if (edge.source !== currentEndpointState.pendingSourceId) return false;
        
        // Find the target node
        const targetNode = currentEndpointState.nodes.find(node => node.id === edge.target);
        return targetNode?.type === 'responseNode';
      });
      
      return hasResponseNode;
    };

    // Check if parent node already has a conditional node
    const checkParentHasConditionalNode = (nodeType: string) => {
      if (nodeType !== 'conditionalNode') return false;
      
      const currentEndpointState = state.currentEndpointId
        ? state.endpoints[state.currentEndpointId]
        : null;
      
      if (!currentEndpointState || !currentEndpointState.pendingSourceId) return false;
      
      // Check if there are any edges from the pending source to conditional nodes
      const hasConditionalNode = currentEndpointState.edges.some(edge => {
        if (edge.source !== currentEndpointState.pendingSourceId) return false;
        
        // Find the target node
        const targetNode = currentEndpointState.nodes.find(node => node.id === edge.target);
        return targetNode?.type === 'conditionalNode';
      });
      
      return hasConditionalNode;
    };

    const handleNodeTypeClick = (nodeType: string) => {
      // Check if trying to add response node when parent already has one
      if (checkParentHasResponseNode(nodeType)) {
        alert("You can't add more than 1 response node to the same parent node.");
        return;
      }
      
      // Check if trying to add conditional node when parent already has one
      if (checkParentHasConditionalNode(nodeType)) {
        alert("You can't add more than 1 conditional node to the same parent node.");
        return;
      }
      
      selectAndAddNode(nodeType);
    };
  return (
    <div className="space-y-2">
      {AVAILABLE_NODE_TYPES.map((nodeType) => {
        const IconComponent = nodeType.icon;
        const isSelected = state.selectedNodeType === nodeType.id;
        const isResponseNodeDisabled = checkParentHasResponseNode(nodeType.id);
        const isConditionalNodeDisabled = checkParentHasConditionalNode(nodeType.id);
        let isDisabled = isResponseNodeDisabled || isConditionalNodeDisabled;
        if (nodeType.id === 'conditionalNode') {
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
              isDisabled && "opacity-50 cursor-not-allowed",
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
                  {IconComponent && (
                    <IconComponent className="h-4 w-4" />
                  )}
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
